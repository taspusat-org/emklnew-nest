import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { RedisService } from 'src/common/redis/redis.service';
import * as fs from 'fs';
import * as path from 'path';
import { Workbook, Column } from 'exceljs';
@Injectable()
export class HargatruckingService {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  private readonly tableName = 'hargatrucking';
  async create(CreateHargatruckingDto: any, trx: any) {
    try {
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        tujuankapal_id,
        emkl_id,
        keterangan,
        container_id,
        jenisorder_id,
        nominal,
        statusaktif,
        modifiedby,
        created_at,
        updated_at,
        info,
      } = CreateHargatruckingDto;
      const insertData = {
        tujuankapal_id: tujuankapal_id,
        emkl_id: emkl_id,
        keterangan: keterangan,
        statusaktif: statusaktif,
        container_id: container_id,
        jenisorder_id: jenisorder_id,
        nominal: nominal,
        modifiedby: modifiedby,
        created_at: created_at || this.utilsService.getTime(),
        updated_at: updated_at || this.utilsService.getTime(),
      };
      console.log(insertData, 'INSERTSSS');
      // Insert the new item
      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');
      const newItem = insertedItems[0]; // Get the inserted item
      const { data, pagination } = await this.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false, // Set based on your requirement (e.g., lookup flag)
        },
        trx,
      );
      let itemIndex = data.findIndex(
        (item) => String(item.id) === String(newItem.id),
      );
      if (itemIndex === -1) {
        itemIndex = 0;
      }

      const pageNumber = Math.floor(itemIndex / limit) + 1;
      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(data),
      );
      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD HARGA TRUCKING',
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );
      return {
        newItem,
        pageNumber,
        itemIndex,
      };
    } catch (error) {
      throw new Error(`Error creating container: ${error.message}`);
    }
  }

  async findAll(
    { search, filters, pagination, sort, isLookUp }: FindAllParams,
    trx: any,
  ) {
    try {
      // default pagination
      let { page, limit } = pagination ?? {};

      page = page ?? 1;
      limit = limit ?? 0;

      // lookup mode: jika total > 500, kirim json saja
      if (isLookUp) {
        const countResult = await trx(this.tableName)
          .count('id as total')
          .first();
        const totalCount = Number(countResult?.total) || 0;
        if (totalCount > 500) {
          return { data: { type: 'json' } };
        }
        limit = 0;
      }

      const query = trx
        .from(trx.raw(`${this.tableName} as b`))
        .select([
          'b.id',
          'b.tarifdetail_id',
          'b.tujuankapal_id',
          'b.emkl_id',
          'b.keterangan',
          'b.container_id',
          'b.jenisorder_id',
          'b.nominal',
          'b.statusaktif',
          'b.info',
          'b.modifiedby',
          trx.raw("TO_CHAR(b.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(b.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'p.memo',
          'p.text',
          'p1.nama as tujuankapal_text',
          'p2.nama as emkl_text',
          'p3.nama as container_text',
          'p4.nama as jenisorderan_text',
        ])
        .leftJoin(
          trx.raw('parameter as p'),
          'b.statusaktif',
          'p.id',
        )
        .leftJoin(
          trx.raw('tujuankapal as p1'),
          'b.tujuankapal_id',
          'p1.id',
        )
        .leftJoin(
          trx.raw('emkl as p2'),
          'b.emkl_id',
          'p2.id',
        )
        .leftJoin(
          trx.raw('container as p3'),
          'b.container_id',
          'p3.id',
        )
        .leftJoin(
          trx.raw('jenisorder as p4'),
          'b.jenisorder_id',
          'p4.id',
        );

      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      const excludeSearchKeys = [
        'tujuankapal_id',
        'statusaktif',
        'emkl_id',
        'container_id',
        'jenisorder_id',
      ];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );
      if (search) {
        const sanitizedValue = String(search).replace(/\[/g, '[[]');

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (['created_at', 'updated_at'].includes(field)) {
              qb.orWhereRaw("TO_CHAR(b.??, 'DD-MM-YYYY HH24:MI:SS') like ?", [
                field,
                `%${sanitizedValue}%`,
              ]);
            } else if (field === 'tujuankapal_text') {
              qb.orWhere(`p1.nama`, 'like', `%${sanitizedValue}%`);
            } else if (field === 'emkl_text') {
              qb.orWhere(`p2.nama`, 'like', `%${sanitizedValue}%`);
            } else if (field === 'container_text') {
              qb.orWhere(`p3.nama`, 'like', `%${sanitizedValue}%`);
            } else if (field === 'jenisorderan_text') {
              qb.orWhere(`p4.nama`, 'like', `%${sanitizedValue}%`);
            } else {
              qb.orWhere(`b.${field}`, 'like', `%${sanitizedValue}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, rawValue] of Object.entries(filters)) {
          if (!rawValue) continue;
          const val = String(rawValue).replace(/\[/g, '[[]');

          if (key === 'created_at' || key === 'updated_at') {
            query.andWhereRaw("TO_CHAR(b.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
              key,
              `%${val}%`,
            ]);
          } else if (key === 'memo') {
            query.andWhere('p.memo', 'like', `%${val}%`);
          } else if (key === 'tujuankapal_text') {
            query.andWhere('p1.nama', 'like', `%${val}%`);
          } else if (key === 'emkl_text') {
            query.andWhere('p2.nama', 'like', `%${val}%`);
          } else if (key === 'container_text') {
            query.andWhere('p3.nama', 'like', `%${val}%`);
          } else if (key === 'jenisorderan_text') {
            query.andWhere('p4.nama', 'like', `%${val}%`);
          } else if (key === 'nominal') {
            query.andWhere('b.nominal', 'like', `%${val}%`);
          } else {
            query.andWhere(`b.${key}`, 'like', `%${val}%`);
          }
        }
      }
      const result = await trx(this.tableName).count('id as total').first();
      const total = result?.total as number;
      const totalPages = Math.ceil(total / limit);

      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }
      const data = await query;
      const responseType = Number(total) > 500 ? 'json' : 'local';

      return {
        data: data,
        type: responseType,
        total,
        pagination: {
          currentPage: page,
          totalPages: totalPages,
          totalItems: total,
          itemsPerPage: limit,
        },
      };
    } catch (error) {
      console.error('Error fetching harga trucking data:', error);
      throw new Error('Failed to fetch harga trucking data');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      const existingData = await trx(this.tableName).where('id', id).first();

      if (!existingData) {
        throw new Error('Harga Trucking not found');
      }

      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        tujuankapal_text,
        emkl_text,
        container_text,
        jenisorderan_text,
        id: skipId,
        text,
        ...insertData
      } = data;

      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['keterangan'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });
      const hasChanges = this.utilsService.hasChanges(insertData, existingData);

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(insertData);
      }

      const { data: filteredData, pagination } = await this.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false, // Set based on your requirement (e.g., lookup flag)
        },
        trx,
      );

      // Cari index item yang baru saja diupdate
      let itemIndex = filteredData.findIndex(
        (item) => String(item.id) === String(id),
      );
      if (itemIndex === -1) {
        itemIndex = 0;
      }

      const itemsPerPage = limit || 10; // Default 10 items per page, atau yang dikirimkan dari frontend
      const pageNumber = Math.floor(itemIndex / itemsPerPage) + 1;

      const endIndex = pageNumber * itemsPerPage;
      const limitedItems = filteredData.slice(0, endIndex);
      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT HARGA TRUCKING',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      return {
        updatedItem: {
          id,
          ...data,
        },
        pageNumber,
        itemIndex,
      };
    } catch (error) {
      console.error('Error updating Bank:', error);
      throw new Error('Failed to update Bank');
    }
  }

  async delete(id: string, trx: any, modifiedby: string) {
    try {
      const deletedData = await this.utilsService.lockAndDestroy(
        id,
        this.tableName,
        'id',
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE HARGA TRUCKING',
          idtrans: deletedData.id,
          nobuktitrans: deletedData.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby,
        },
        trx,
      );

      return { status: 200, message: 'Data deleted successfully', deletedData };
    } catch (error) {
      console.error('Error deleting data:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }

  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:H1');
    worksheet.mergeCells('A2:H2');
    worksheet.mergeCells('A3:H3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN HARGA TRUCKING';
    worksheet.getCell('A3').value = 'Data Export';
    ['A1', 'A2', 'A3'].forEach((cellKey, i) => {
      worksheet.getCell(cellKey).alignment = {
        horizontal: 'center',
        vertical: 'middle',
      };
      worksheet.getCell(cellKey).font = {
        name: 'Tahoma',
        size: i === 0 ? 14 : 10,
        bold: true,
      };
    });

    const headers = [
      'NO.',
      'TUJUAN KAPAL',
      'EMKL',
      'KETERANGAN',
      'CONTAINER',
      'JENIS ORDERAN',
      'NOMINAL',
      'STATUS AKTIF',
    ];

    headers.forEach((header, index) => {
      const cell = worksheet.getCell(5, index + 1);
      cell.value = header;
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFF00' },
      };
      cell.font = { bold: true, name: 'Tahoma', size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    data.forEach((row, rowIndex) => {
      const currentRow = rowIndex + 6;
      const rowValues = [
        rowIndex + 1,
        row.tujuankapal_text,
        row.emkl_text,
        row.keterangan,
        row.container_text,
        row.jenisorderan_text,
        row.nominal,
        row.text,
      ];
      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);
        cell.value = value ?? '';
        cell.font = { name: 'Tahoma', size: 10 };

        if (colIndex === 6) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.numFmt = '#,##0'; // Format angka dengan pemisah ribuan
        } else {
          cell.alignment = {
            horizontal: colIndex === 0 ? 'right' : 'left',
            vertical: 'middle',
          };
        }

        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    });

    worksheet.columns
      .filter((c): c is Column => !!c)
      .forEach((col) => {
        let maxLength = 0;
        col.eachCell({ includeEmpty: true }, (cell) => {
          const cellValue = cell.value ? cell.value.toString() : '';
          maxLength = Math.max(maxLength, cellValue.length);
        });
        col.width = maxLength + 2;
      });

    worksheet.getColumn(1).width = 6;
    worksheet.getColumn(8).width = 20;
    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_hargatrucking_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
