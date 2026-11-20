import * as fs from 'fs';
import * as path from 'path';
import { Column, Workbook } from 'exceljs';
import { LocksService } from '../locks/locks.service';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { GlobalService } from '../global/global.service';
import { RedisService } from 'src/common/redis/redis.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

@Injectable()
export class GroupInvoiceService {
  private readonly tableName = 'groupinvoice';

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilService: UtilsService,
    private readonly locksService: LocksService,
    private readonly utilsService: UtilsService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
  ) {}

  async create(createData: any, trx: any) {
    try {
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        statusaktif_nama,
        id,
        method,
        ...insertData
      } = createData;

      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['kode', 'keterangan'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      const insertedData = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

      const newData = insertedData[0];

      const { data, pagination } = await this.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false,
          // forTemp: true, // <-- aktifkan kalau kamu sudah implement opsi ini di findAll
        },
        trx,
      );

      let dataIndex = data.findIndex((item) => item.id === newData.id);
      if (dataIndex === -1) {
        dataIndex = 0;
      }

      const pageNumber = Math.floor(dataIndex / limit) + 1;
      const endIndex = pageNumber * limit;
      const limitedItems = data.slice(0, endIndex);

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD MARKETING`,
          idtrans: newData.id,
          nobuktitrans: newData.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newData),
          modifiedby: newData.modifiedby,
        },
        trx,
      );

      return {
        newData,
        pageNumber,
        dataIndex,
      };
    } catch (error) {
      throw new Error(
        `Error creating group invoice in service: ${error.message}`,
      );
    }
  }

  async findAll(
    { search, filters, pagination, sort, isLookUp }: FindAllParams,
    trx: any,
  ) {
    try {
      let { page, limit } = pagination ?? {};
      page = page ?? 1;
      limit = limit ?? 0;

      if (isLookUp) {
        const groupInvoiceResult = await trx(this.tableName)
          .count('id as total')
          .first();

        const totalData = groupInvoiceResult?.total || 0;
        if (Number(totalData) > 500) {
          return { data: { type: 'json' } };
        } else {
          limit = 0;
        }
      }

      const query = trx(`${this.tableName} as p`)
        .select([
          'p.id',
          'p.kode',
          'p.keterangan',
          'p.statusaktif',
          'p.modifiedby',
          trx.raw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'statusaktif.memo',
          'statusaktif.text as statusaktif_nama',
        ])
        .leftJoin(
          'parameter as statusaktif',
          'p.statusaktif',
          'statusaktif.id',
        );

      if (search) {
        const sanitizedValue = String(search);
        query.where((builder) => {
          builder
            .orWhere('p.kode', 'ilike', `%${sanitizedValue}%`)
            .orWhere('p.keterangan', 'ilike', `%${sanitizedValue}%`)
            .orWhere('p.modifiedby', 'ilike', `%${sanitizedValue}%`)
            // .orWhereRaw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
            //   `%${sanitizedValue}%`,
            // ])
            .orWhere('p.created_at', 'ilike', `%${sanitizedValue}%`)
            .orWhere('p.updated_at', 'ilike', `%${sanitizedValue}%`);
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value);
          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw("TO_CHAR(p.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'statusaktif_nama') {
              query.andWhere(`statusaktif.id`, '=', sanitizedValue);
            } else {
              query.andWhere(`p.${key}`, 'ilike', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'statusaktif') {
          // Postgres: memo bertipe text berisi JSON → ekstrak lewat jsonb.
          query.orderByRaw(
            `(statusaktif.memo::jsonb ->> 'MEMO') ${sort.sortDirection}`,
          );
        } else {
          query.orderBy(sort.sortBy, sort.sortDirection);
        }
      }
      // Tiebreaker WAJIB: tiap halaman diambil lewat query LIMIT/OFFSET
      // terpisah, dan ORDER BY yang nilainya seri (mis. sort STATUS AKTIF yang
      // cuma punya 2 nilai) tak dijamin stabil antar query → satu baris bisa
      // muncul di dua halaman ("two children with the same key" di grid).
      query.orderBy('p.id', 'asc');

      const result = await trx(this.tableName).count('id as total').first();
      const total = result?.total as number;
      const totalPages = Math.ceil(total / limit);
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
          itemsPerPage: limit > 0 ? limit : total,
        },
      };
    } catch (error) {
      console.error('Error fetching data group invoice in service:', error);
      throw new Error(error);
    }
  }

  async update(dataId: string, data: any, trx: any) {
    try {
      const existingData = await trx(this.tableName)
        .where('id', dataId)
        .first();

      if (!existingData) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Data Not Found!',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        statusaktif_nama,
        id,
        method,
        ...updateData
      } = data;

      Object.keys(updateData).forEach((key) => {
        if (typeof updateData[key] === 'string') {
          updateData[key] = updateData[key].toUpperCase();
        }
      });

      const hasChanges = this.utilService.hasChanges(updateData, existingData);

      if (hasChanges) {
        updateData.updated_at = this.utilService.getTime();
        await trx(this.tableName).where('id', id).update(updateData);
      }

      const { data: filteredData, pagination } = await this.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false,
        },
        trx,
      );

      let dataIndex = filteredData.findIndex(
        (item) => String(item.id) === String(id),
      );

      if (dataIndex === -1) {
        dataIndex = 0;
      }

      const itemsPerPage = limit || 30;
      const pageNumber = Math.floor(dataIndex / itemsPerPage) + 1;
      const endIndex = pageNumber * itemsPerPage;
      const limitedItems = filteredData.slice(0, endIndex);

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT GROUP INVOICE',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      return {
        newItems: {
          id,
          ...data,
        },
        pageNumber,
        dataIndex,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      console.error('Error updating group invoice in service:', error);
      throw new Error('Failed to update group invoice in service');
    }
  }

  async delete(id: string, trx: any, modifiedby: string) {
    try {
      const deletedData = await this.utilService.lockAndDestroy(
        id,
        this.tableName,
        'id',
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE GROUP INVOICE',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby,
        },
        trx,
      );

      return {
        status: 200,
        message: 'Data deleted successfully',
        deletedData,
      };
    } catch (error) {
      console.error('Error deleting data group invoice in service: ', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete data group invoice ini service',
      );
    }
  }

  async checkValidasi(aksi: string, value: any, editedby: any, trx: any) {
    try {
      if (aksi === 'EDIT') {
        const forceEdit = await this.locksService.forceEdit(
          this.tableName,
          value,
          editedby,
          trx,
        );

        return forceEdit;
      } else if (aksi === 'DELETE') {
        // Template memeriksa `marketingprosesfee.jenisprosesfee_id` — kolom
        // milik modul jenis-proses-fee. Setelah rename jadi `groupinvoice_id`
        // kolomnya tak pernah ada, query melempar error → 500 → dialog
        // "ERROR!" tanpa keterangan. Saat ini TIDAK ADA tabel yang
        // mereferensikan groupinvoice, jadi pakai katalog FK Postgres supaya
        // otomatis ikut kalau nanti ada tabel anak.
        const usedBy = await this.utilService.findFirstReference(
          this.tableName,
          value,
          trx,
        );

        return usedBy
          ? {
              status: 'failed',
              message: `Data ini tidak diizinkan untuk dihapus karena masih dipakai di tabel ${usedBy.ref_table}.`,
            }
          : { status: 'success', message: 'Data aman untuk dihapus.' };
      }
    } catch (error) {
      console.error('Error di checkValidasi:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }

  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:D1');
    worksheet.mergeCells('A2:D2');
    worksheet.mergeCells('A3:D3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN GROUP INVOICE';
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

    // Mendefinisikan header kolom
    const headers = ['NO.', 'KODE', 'KETERANGAN', 'STATUS AKTIF'];

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
        horizontal: 'center',
        vertical: 'middle',
      };

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
        row.kode,
        row.keterangan,
        row.statusaktif_nama,
      ];

      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);

        cell.value = value ?? '';
        cell.font = { name: 'Tahoma', size: 10 };
        cell.alignment = {
          horizontal: colIndex === 0 ? 'right' : 'left',
          vertical: 'middle',
        };
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

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_group_invoice_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }

  findOne(id: string) {
    return `This action returns a #${id} groupinvoice`;
  }
}
