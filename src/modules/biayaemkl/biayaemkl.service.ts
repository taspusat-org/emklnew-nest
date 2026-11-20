import {
  Inject,
  Injectable,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { CreateBiayaemklDto } from './dto/create-biayaemkl.dto';
import { UpdateBiayaemklDto } from './dto/update-biayaemkl.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { withUuidV7, formatDateToSQL, UtilsService  } from 'src/utils/utils.service';
import { RedisService } from 'src/common/redis/redis.service';
import * as fs from 'fs';
import * as path from 'path';
import { Workbook, Column } from 'exceljs';

// Kolom yang isinya id/kode, bukan teks bebas: jangan di-uppercase saat update.
// Id yang dibuat uuidV7 huruf kecil, dan meng-uppercase-nya melanggar foreign key.
const ID_COLUMNS = [
  'biaya_id',
  'coahut',
  'jenisorder_id',
  'statusaktif',
  'statusbiayabl',
  'statusseal',
  'statustagih',
];

@Injectable()
export class BiayaemklService {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  private readonly tableName = 'biayaemkl';
  async create(CreateBiayaemklDto: any, trx: any) {
    try {
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        nama,
        keterangan,
        biaya_id,
        coahut,
        jenisorder_id,
        statusaktif,
        statusbiayabl,
        statusseal,
        statustagih,
        modifiedby,
        created_at,
        updated_at,
        info,
      } = CreateBiayaemklDto;
      const insertData = {
        nama: nama ? nama.toUpperCase() : null,
        keterangan: keterangan ? keterangan.toUpperCase() : null,
        biaya_id: biaya_id,
        coahut: coahut,
        jenisorder_id: jenisorder_id,
        statusbiayabl: statusbiayabl,
        statusseal: statusseal,
        statustagih: statustagih,
        statusaktif: statusaktif,
        modifiedby: modifiedby,
        created_at: created_at || this.utilsService.getTime(),
        updated_at: updated_at || this.utilsService.getTime(),
      };
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
          postingdari: 'ADD BIAYA EMKL',
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
      throw new Error(`Error creating biaya emkl: ${error.message}`);
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

      // build query
      const query = trx
        .from(trx.raw(`${this.tableName} as b`))
        .select([
          'b.id',
          'b.nama',
          'b.keterangan',
          'b.biaya_id',
          'b.coahut',
          'b.jenisorder_id',
          'b.statusbiayabl',
          'b.statusseal',
          'b.statustagih',
          'b.statusaktif',
          'b.info',
          'b.modifiedby',
          trx.raw("TO_CHAR(b.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(b.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'p.memo',
          'p.text',
          'p1.nama as biaya_text',
          'p2.keterangancoa as coahut_text',
          'p3.nama as jenisorderan_text',
          'p4.text as statusbiayabl_text',
          'p4.memo as statusbiayabl_memo',
          'p5.text as statusseal_text',
          'p5.memo as statusseal_memo',
          'p6.text as statustagih_text',
          'p6.memo as statustagih_memo',
        ])
        .leftJoin(
          trx.raw('parameter as p'),
          'b.statusaktif',
          'p.id',
        )
        .leftJoin(
          trx.raw('biaya as p1'),
          'b.biaya_id',
          'p1.id',
        )
        .leftJoin(
          trx.raw('akunpusat as p2'),
          'b.coahut',
          'p2.coa',
        )
        // Tabel FK fisik bernama `jenisorder` (bukan `jenisorderan`).
        .leftJoin(
          trx.raw('jenisorder as p3'),
          'b.jenisorder_id',
          'p3.id',
        )
        .leftJoin(
          trx.raw('parameter as p4'),
          'b.statusbiayabl',
          'p4.id',
        )
        .leftJoin(
          trx.raw('parameter as p5'),
          'b.statusseal',
          'p5.id',
        )
        .leftJoin(
          trx.raw('parameter as p6'),
          'b.statustagih',
          'p6.id',
        );

      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }
      const excludeSearchKeys = [
        'biaya_id',
        'coahut',
        'jenisorder_id',
        'statusaktif',
        'statusbiayabl',
        'statusbiayabl_text',
        'statusseal',
        'statusseal_text',
        'statustagih',
        'statustagih_text',
      ];

      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (search) {
        const sanitizedValue = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (['created_at', 'updated_at'].includes(field)) {
              qb.orWhereRaw("TO_CHAR(b.??, 'DD-MM-YYYY HH24:MI:SS') like ?", [
                field,
                `%${sanitizedValue}%`,
              ]);
            } else if (field === 'memo' || field === 'text') {
              qb.orWhere(`p.${field}`, 'like', `%${sanitizedValue}%`);
            } else if (field === 'biaya_text') {
              qb.orWhere('p1.nama', 'like', `%${sanitizedValue}%`);
            } else if (field === 'coahut_text') {
              qb.orWhere('p2.keterangancoa', 'like', `%${sanitizedValue}%`);
            } else if (field === 'jenisorderan_text') {
              qb.orWhere('p3.nama', 'like', `%${sanitizedValue}%`);
            } else {
              qb.orWhere(`b.${field}`, 'like', `%${sanitizedValue}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, rawValue] of Object.entries(filters)) {
          if (key === 'tglDari' || key === 'tglSampai') continue;
          if (!rawValue) continue;

          const val = String(rawValue).replace(/\[/g, '[[]');

          if (key === 'created_at' || key === 'updated_at') {
            query.andWhereRaw("TO_CHAR(b.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
              key,
              `%${val}%`,
            ]);
          } else if (key === 'statusaktif') {
            query.andWhere('b.statusaktif', 'like', `%${val}%`);
          } else if (key === 'memo') {
            query.andWhere('p.memo', 'like', `%${val}%`);
          } else if (key === 'text') {
            query.andWhere('p.text', 'like', `%${val}%`);
          } else if (key === 'biaya_text') {
            query.andWhere('p1.nama', 'like', `%${val}%`);
          } else if (key === 'coahut_text') {
            query.andWhere('p2.keterangancoa', 'like', `%${val}%`);
          } else if (key === 'jenisorderan_text') {
            query.andWhere('p3.nama', 'like', `%${val}%`);
          } else if (key === 'statusbiayabl_text') {
            query.andWhere('p4.text', 'like', `%${val}%`);
          } else if (key === 'statusseal_text') {
            query.andWhere('p5.text', 'like', `%${val}%`);
          } else if (key === 'statustagih_text') {
            query.andWhere('p6.text', 'like', `%${val}%`);
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
      console.error('Error fetching biaya emkl data:', error);
      throw new Error('Failed to fetch biaya emkl data');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      const existingData = await trx(this.tableName).where('id', id).first();

      if (!existingData) {
        throw new Error('Biaya Emkl not found');
      }

      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        biaya_text,
        coahut_text,
        jenisorderan_text,
        statusbiayabl_text,
        statusseal_text,
        // Tanpa ini `statustagih_text` ikut masuk insertData dan knex mencoba
        // meng-update kolom yang tidak ada → 500 setiap kali edit disimpan.
        statustagih_text,
        id: skipId,
        text,
        ...insertData
      } = data;

      Object.keys(insertData).forEach((key) => {
        if (ID_COLUMNS.includes(key)) return; // id lookup: uuidV7 huruf kecil, jangan di-uppercase
        if (typeof insertData[key] === 'string') {
          insertData[key] = insertData[key].toUpperCase();
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
          postingdari: 'EDIT BIAYA EMKL',
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
      console.error('Error updating Biaya EMKL:', error);
      throw new Error('Failed to update Biaya EMKL');
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
          postingdari: 'DELETE BIAYA EMKL',
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
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }

  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:G1');
    worksheet.mergeCells('A2:G2');
    worksheet.mergeCells('A3:G3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN BIAYA EMKL';
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
      'NAMA',
      'KETERANGAN',
      'BIAYA',
      'COA HUTANG',
      'JENIS ORDERAN',
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
      cell.alignment = {
        horizontal: index === 0 ? 'right' : 'center', // header NO. -> kanan
        vertical: 'middle',
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    worksheet.getRow(5).height = 18;

    data.forEach((row, rowIndex) => {
      const currentRow = rowIndex + 6;

      worksheet.getCell(currentRow, 1).value = rowIndex + 1;
      worksheet.getCell(currentRow, 2).value = row.nama;
      worksheet.getCell(currentRow, 3).value = row.keterangan;
      worksheet.getCell(currentRow, 4).value = row.biaya_text;
      worksheet.getCell(currentRow, 5).value = row.coahut_text;
      worksheet.getCell(currentRow, 6).value = row.jenisorderan_text;
      worksheet.getCell(currentRow, 7).value = row.text;

      // Styling untuk setiap cell
      for (let col = 1; col <= headers.length; col++) {
        const cell = worksheet.getCell(currentRow, col);
        cell.font = { name: 'Tahoma', size: 10 };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
        cell.alignment = {
          horizontal: col === 1 ? 'right' : 'left', // NO. rata kanan
          vertical: 'middle',
        };
      }
    });

    worksheet.getColumn(1).width = 6;
    worksheet.getColumn(2).width = 20;
    worksheet.getColumn(3).width = 30;
    worksheet.getColumn(4).width = 25;
    worksheet.getColumn(5).width = 25;
    worksheet.getColumn(6).width = 20;
    worksheet.getColumn(7).width = 15;

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_biayaemkl_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
