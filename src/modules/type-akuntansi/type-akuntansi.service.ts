import {
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Column, Workbook } from 'exceljs';
import { dbMssql } from 'src/common/utils/db';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { GlobalService } from '../global/global.service';
import { RedisService } from 'src/common/redis/redis.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { LocksService } from '../locks/locks.service';

@Injectable()
export class TypeAkuntansiService {
  private readonly tableName: string = 'typeakuntansi';

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilService: UtilsService,
    private readonly globalService: GlobalService,
    private readonly locksService: LocksService,
    private readonly logTrailService: LogtrailService,
    private readonly utilsService: UtilsService,
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
        method,
        statusaktif_text,
        akuntansi_nama,
        id,
        ...insertData
      } = createData;
      insertData.updated_at = this.utilsService.getTime();
      insertData.created_at = this.utilsService.getTime();
      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['nama', 'keterangan'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      const insertedData = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

      const newItem = insertedData[0];

      // Ambil data utk dimasukkan ke temp table
      // ==== NEW ==== kalau kamu sudah menambahkan flag forTemp di findAll,
      // set forTemp: true agar created_at/updated_at tidak di-FORMAT dan kolom ekstra tidak dipilih
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
      let dataIndex = data.findIndex((item) => item.id === newItem.id);
      if (dataIndex === -1) {
        dataIndex = 0;
      }

      // Optionally, you can find the page number or other info if needed
      const pageNumber = pagination?.currentPage;
      // simpan cache & log seperti sebelumnya
      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(data),
      );

      await this.logTrailService.create(
        {
          namatable: this.tableName,
          postingdari: 'ADD TYPE AKUNTANSI',
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      return { newItem, pageNumber, dataIndex };
    } catch (error) {
      throw new Error(`Error creating type akuntansi: ${error.message}`);
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
        const totalData = await trx(this.tableName)
          .count('id as total')
          .first();

        const resultTotalData = totalData?.total || 0;

        if (Number(resultTotalData) > 500) {
          return {
            data: {
              type: 'json',
            },
          };
        } else {
          limit = 0;
        }
      }

      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.nama',
          'u.order',
          'u.keterangan',
          'u.akuntansi_id',
          'u.statusaktif',
          'u.modifiedby',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'p.memo',
          'p.text as statusaktif_text',
          'ak.nama as akuntansi_nama',
        ])
        .leftJoin('parameter as p', 'u.statusaktif', 'p.id')
        .leftJoin('akuntansi as ak', 'u.akuntansi_id', 'ak.id');

      const excludeSearchKeys = ['statusaktif', 'text', 'icon'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (search) {
        const sanitized = String(search).trim();
        query.where((qb) => {
          searchFields.forEach((field) => {
            if (field === 'akuntansi') {
              qb.orWhere(`ak.nama`, 'ilike', `%${sanitized}%`);
            } else if (field === 'created_at' || field === 'updated_at') {
              qb.orWhereRaw(
                `TO_CHAR(u.${field}, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?`,
                [`%${sanitized}%`],
              );
            } else {
              qb.orWhere(`u.${field}`, 'ilike', `%${sanitized}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value);
          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'statusaktif_text' || key === 'memo') {
              query.andWhere(`p.text`, '=', sanitizedValue);
            } else if (key === 'akuntansi') {
              query.andWhere('ak.nama', 'ilike', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`u.${key}`, 'ilike', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      const result = await trx(this.tableName).count('id as total').first();
      const total = result?.total as number;
      // const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
      const totalPages = Math.ceil(total / limit);

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort.sortBy === 'akuntansi') {
          query.orderBy('ak.nama', sort.sortDirection);
        } else {
          query.orderBy(sort.sortBy, sort.sortDirection);
        }
      }

      const data = await query;

      const responseType = Number(total) > 500 ? 'json' : 'local';

      return {
        data: data,
        type: responseType,
        total,
        pagination: {
          currentPage: Number(page),
          totalPages: totalPages,
          totalItems: total,
          itemsPerPage: limit > 0 ? limit : total,
        },
      };
    } catch (error) {
      console.error('Error to findAll Type Akuntansi', error);
      throw new Error(error);
    }
  }

  // async findAllByIds(ids: { id: number }[]) {
  //   try {
  //     const idList = ids.map((item) => item.id)

  //     const tempData = `##temp_${Math.random().toString(36).substring(2, 15)}`;

  //     // Membuat temporary table
  //     const createTempTableQuery = `CREATE TABLE ${tempData} (id INT);`;
  //     await dbMssql.raw(createTempTableQuery);

  //     // Memasukkan data ID ke dalam temporary table
  //     const insertTempTableQuery = `
  //       INSERT INTO ${tempData} (id)
  //       VALUES ${idList.map((id) => `(${id})`).join(', ')};
  //     `;
  //     await dbMssql.raw(insertTempTableQuery);

  //     // Query utama dengan JOIN ke temporary table
  //     const query = dbMssql(`${this.tableName} as u`)
  //       .select([
  //         'u.id as id',
  //         'u.nama',
  //         'u.order',
  //         'u.keterangan',
  //         'u.akuntansi_id',
  //         'u.statusaktif',
  //         'u.modifiedby',
  //         dbMssql.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
  //         dbMssql.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
  //         'p.memo',
  //         'p.text',
  //         'q.nama'
  //       ])
  //       .join('parameter as p', 'u.statusaktif', 'p.id')
  //       // .leftJoin('akuntansi as q', 'u.akuntansi_id', 'q.id');
  //       .join(dbMssql.raw(`${tempData} as temp`), 'u.id', 'temp.id') // Menggunakan JOIN antar tabel user dan temporary table
  //       .orderBy('u.nama', 'ASC');

  //     const data = await query;

  //     const dropTempTableQuery = `DROP TABLE ${tempData};`;
  //     await dbMssql.raw(dropTempTableQuery);

  //     return data;
  //   } catch (error) {
  //     console.error('Error fetching data:', error);
  //     throw new Error('Failed to fetch data');
  //   }
  // }

  async update(dataId: number, data: any, trx: any) {
    try {
      const existingData = await trx(this.tableName)
        .where('id', dataId)
        .first();

      if (!existingData) {
        // throw new Error('Data Not Found!');
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
        statusaktif_text,
        akuntansi_nama,
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
      //

      if (dataIndex === -1) {
        throw new Error('Updated item not found in all items');
      }

      const itemsPerPage = limit || 30;
      const pageNumber = Math.floor(dataIndex / itemsPerPage) + 1;

      // ambil data hingga halaman yg mencakup item yg baru diupdate
      const endIndex = pageNumber * itemsPerPage;
      const limitedItems = filteredData.slice(0, endIndex);

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT TYPE AKUNTANSI',
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

      console.error('Error updating type akuntansi:', error);
      throw new Error('Failed to update type akuntansi');
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
          postingdari: 'DELETE TYPE AKUNTANSI',
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
      console.error('Error deleting data: ', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
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
        const validasi = await this.globalService.checkUsed(
          'akunpusat',
          'type_id',
          value,
          trx,
        );

        return validasi;
      }
    } catch (error) {
      console.error('Error di checkValidasi:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }

  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:F1');
    worksheet.mergeCells('A2:F2');
    worksheet.mergeCells('A3:F3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN TYPE AKUNTANSI';
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
    const headers = [
      'NO.',
      'NAMA',
      'ORDER',
      'KETERANGAN',
      'AKUNTANSI',
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
        horizontal: 'center',
        vertical: 'middle',
      };

      // if (index === 2) {
      //   cell.alignment = { horizontal: 'right', vertical: 'middle' };
      //   cell.numFmt = '0'; // angka polos tanpa ribuan / desimal
      // } else {
      //   cell.alignment = {
      //     horizontal: index === 0 ? 'right' : 'left',
      //     vertical: 'middle',
      //   };
      // }

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
        row.nama,
        row.order,
        row.keterangan,
        row.akuntansi_nama,
        row.statusaktif_text,
      ];

      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);

        if (colIndex === 2) {
          cell.value = Number(value);
          cell.numFmt = '0'; // format angka dengan ribuan
          cell.alignment = {
            horizontal: 'right',
            vertical: 'middle',
          };
        } else {
          cell.value = value ?? '';
          cell.alignment = {
            horizontal: colIndex === 0 ? 'right' : 'left',
            vertical: 'middle',
          };
        }

        // cell.value = value ?? '';
        cell.font = { name: 'Tahoma', size: 10 };
        // cell.alignment = {
        //   horizontal: colIndex === 0 ? 'right' : 'left',
        //   vertical: 'middle',
        // };
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
      `laporan_type_akuntansi_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
