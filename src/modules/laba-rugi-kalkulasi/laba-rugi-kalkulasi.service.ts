import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Column, Workbook } from 'exceljs';
import { LocksService } from '../locks/locks.service';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { GlobalService } from '../global/global.service';
import { RedisService } from 'src/common/redis/redis.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';

@Injectable()
export class LabaRugiKalkulasiService {
  private readonly tableName: string = 'labarugikalkulasi';

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
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
        method,
        id,
        statusfinalkomisi_nama,
        statusfinalbonus_nama,
        ...insertData
      } = createData;

      insertData.updated_at = this.utilsService.getTime();
      insertData.created_at = this.utilsService.getTime();
      console.log('insertData', insertData);

      Object.keys(insertData).forEach((key) => {
        if (typeof insertData[key] === 'string') {
          insertData[key] = insertData[key].toUpperCase();
        }
      });

      const insertedData = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

      const newItem = insertedData[0];
      const { data, pagination } = await this.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false,
        },
        trx,
      );

      let dataIndex = data.findIndex((item) => item.id === newItem.id);
      if (dataIndex === -1) {
        dataIndex = 0;
      }

      // Optionally, you can find the page number or other info if needed
      const pageNumber = pagination?.currentPage;

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(data),
      );

      await this.logTrailService.create(
        {
          namatable: this.tableName,
          postingdari: 'ADD LABA RUGI KALKULASI',
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
        dataIndex,
      };
    } catch (error) {
      throw new Error(`Error creating laba rugi kalkulasi: ${error.message}`);
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

      const query = trx
        .from(trx.raw(`${this.tableName} as u`))
        .select([
          'u.id as id',
          'u.periode',
          // trx.raw("FORMAT(u.periode, 'MM-yyyy') as periode"),
          'u.estkomisimarketing',
          'u.komisimarketing',
          'u.biayakantorpusat',
          'u.biayatour',
          'u.gajidireksi',
          'u.estkomisikacab',
          'u.biayabonustriwulan',
          'u.estkomisimarketing2',
          'u.estkomisikacabcabang1',
          'u.estkomisikacabcabang2',
          'u.statusfinalkomisimarketing',
          'u.statusfinalbonustriwulan',
          'u.modifiedby',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'p.text as statusfinalkomisi_nama',
          'p.memo as statusfinalkomisi_memo',
          'q.text as statusfinalbonus_nama',
          'q.memo as statusfinalbonus_memo',
        ])
        .leftJoin('parameter as p', 'u.statusfinalkomisimarketing', 'p.id')
        .leftJoin('parameter as q', 'u.statusfinalbonustriwulan', 'q.id');

      if (search) {
        const sanitizedValue = String(search).replace(/\[/g, '[[]');
        query.where((builder) => {
          builder
            // .orWhereRaw("FORMAT(u.periode, 'MM-yyyy') LIKE ?", [`%${sanitizedValue}%`])
            .orWhere('u.periode', 'like', `%${sanitizedValue}%`)
            .orWhere('u.estkomisimarketing', 'like', `%${sanitizedValue}%`)
            .orWhere('u.komisimarketing', 'like', `%${sanitizedValue}%`)
            .orWhere('u.biayakantorpusat', 'like', `%${sanitizedValue}%`)
            .orWhere('u.biayatour', 'like', `%${sanitizedValue}%`)
            .orWhere('u.gajidireksi', 'like', `%${sanitizedValue}%`)
            .orWhere('u.estkomisikacab', 'like', `%${sanitizedValue}%`)
            .orWhere('u.biayabonustriwulan', 'like', `%${sanitizedValue}%`)
            .orWhere('u.estkomisimarketing2', 'like', `%${sanitizedValue}%`)
            .orWhere('u.estkomisikacabcabang1', 'like', `%${sanitizedValue}%`)
            .orWhere('u.estkomisikacabcabang2', 'like', `%${sanitizedValue}%`)
            .orWhere('p.text', 'like', `%${sanitizedValue}%`)
            .orWhere('q.text', 'like', `%${sanitizedValue}%`)
            .orWhere('u.modifiedby', 'like', `%${sanitizedValue}%`)
            .orWhereRaw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
              `%${sanitizedValue}%`,
            ])
            .orWhereRaw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
              `%${sanitizedValue}%`,
            ]);
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'statusfinalkomisi_text') {
              query.andWhere('p.id', '=', sanitizedValue);
            } else if (key === 'statusfinalbonus_text') {
              query.andWhere('q.id', '=', sanitizedValue);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'periode') {
          // query.orderBy(sort.sortBy, sort.sortDirection);
          query.orderByRaw(`RIGHT(??, 4) + LEFT(??, 2) ${sort.sortDirection}`, [
            sort.sortBy,
            sort.sortBy,
          ]);
        } else if (sort?.sortBy === 'statusfinalkomisi') {
          const memoExpr = '(CASE WHEN p.memo IS JSON THEN p.memo::jsonb END)'; // penting: TEXT/NTEXT -> text
          query.orderByRaw(
            `JSON_VALUE(${memoExpr}, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statusfinalbonus') {
          const memoExpr = '(CASE WHEN q.memo IS JSON THEN q.memo::jsonb END)';
          query.orderByRaw(
            `JSON_VALUE(${memoExpr}, '$.MEMO') ${sort.sortDirection}`,
          );
        } else {
          query.orderBy(sort.sortBy, sort.sortDirection);
        }
      }

      const result = await trx(this.tableName).count('id as total').first();
      const total = result?.total as number;
      const totalPages = Math.ceil(total / limit);
      const data = await query;
      console.log('data', data);
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
      console.error('Error to findAll Laba Rugi Kalkulasi', error);
      throw new Error(error);
    }
  }

  async update(dataId: number, data: any, trx: any) {
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
        statusfinalkomisi_nama,
        statusfinalbonus_nama,
        id,
        method,
        ...updateData
      } = data;

      Object.keys(updateData).forEach((key) => {
        if (typeof updateData[key] === 'string') {
          updateData[key] = updateData[key].toUpperCase();
        }
      });
      console.log('updateData', updateData);

      const hasChanges = this.utilsService.hasChanges(updateData, existingData);

      if (hasChanges) {
        updateData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', dataId).update(updateData);
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
        (item) => String(item.id) === String(dataId),
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
          postingdari: 'EDIT LABA RUGI KALKULASI',
          idtrans: dataId,
          nobuktitrans: dataId,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      return {
        newItems: {
          dataId,
          ...data,
        },
        pageNumber,
        dataIndex,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      console.error('Error updating laba rugi kalkulasi:', error);
      throw new Error('Failed to update laba rugi kalkulasi');
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
          postingdari: 'DELETE LABA RUGI KALKULASI',
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
        return {
          status: 'success',
          message: 'Data aman untuk dihapus.',
        };
      }
    } catch (error) {
      console.error('Error di checkValidasi:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }

  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:K1');
    worksheet.mergeCells('A2:K2');
    worksheet.mergeCells('A3:K3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN LABA RUGI KALKULASI';
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
      'PERIODE',
      'EST KOMISI MARKETING',
      'KOMISI MARKETING',
      'BIAYA KANTOR PUSAT',
      'BIAYA TOUR',
      'GAJI DIREKSI',
      'EST KOMISI KACAB',
      'BIAYA BONUS TRI WULAN',
      'EST KOMISI MARKETING 2',
      'EST KOMISI KACAB CABANG 1',
      'EST KOMISI KACAB CABANG 2',
      'STATUS FINAL KOMISI MARKETING',
      'STATUS FINAL BONUS TRI WULAN',
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
        row.periode,
        row.estkomisimarketing,
        row.komisimarketing,
        row.biayakantorpusat,
        row.biayatour,
        row.gajidireksi,
        row.estkomisikacab,
        row.biayabonustriwulan,
        row.estkomisimarketing2,
        row.estkomisikacabcabang1,
        row.estkomisikacabcabang2,
        row.statusfinalkomisi_nama,
        row.statusfinalbonus_nama,
      ];
      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);

        if (colIndex === 1) {
          cell.value = value ?? '';
          cell.alignment = {
            horizontal: 'left',
            vertical: 'middle',
          };
        } else if (colIndex === 0) {
          cell.value = value ?? '';
          cell.alignment = {
            horizontal: 'right',
            vertical: 'middle',
          };
        } else if (colIndex === 12 || colIndex === 13) {
          cell.value = value ?? '';
          cell.alignment = {
            horizontal: 'right',
            vertical: 'middle',
          };
        } else {
          cell.value = Number(value);
          cell.numFmt = '#,##0.00';
          cell.alignment = {
            horizontal: 'right',
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
    worksheet.getColumn(4).width = 20;

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_labarugi_kalkulasi_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
