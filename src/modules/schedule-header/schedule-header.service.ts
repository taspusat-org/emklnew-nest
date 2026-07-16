import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Column, Workbook } from 'exceljs';
import { LocksService } from '../locks/locks.service';
import { GlobalService } from '../global/global.service';
import { RedisService } from 'src/common/redis/redis.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { withUuidV7, formatDateToSQL, UtilsService  } from 'src/utils/utils.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { ScheduleDetailService } from '../schedule-detail/schedule-detail.service';

@Injectable()
export class ScheduleHeaderService {
  private readonly tableName = 'scheduleheader';

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly scheduleDetailService: ScheduleDetailService,
  ) {}

  async create(data: any, trx: any) {
    try {
      data.tglbukti = formatDateToSQL(String(data?.tglbukti));

      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        details,
        method,
        ...insertedData
      } = data;
      insertedData.updated_at = this.utilsService.getTime();
      insertedData.created_at = this.utilsService.getTime();

      Object.keys(insertedData).forEach((key) => {
        if (typeof insertedData[key] === 'string') {
          insertedData[key] = insertedData[key].toUpperCase();
        }
      });

      const parameter = await trx('parameter')
        .select('*')
        .where('grp', 'SCHEDULE')
        .first();

      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        parameter.grp,
        parameter.subgrp,
        this.tableName,
        insertedData.tglbukti,
      );
      insertedData.nobukti = nomorBukti;

      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertedData))
        .returning('*');

      if (details.length > 0) {
        // insert nobukti into each item of detail
        const detailsWithNobukti = details.map((detail: any) => ({
          ...detail,
          nobukti: nomorBukti,
          modifiedby: insertedData.modifiedby,
        }));

        await this.scheduleDetailService.create(
          detailsWithNobukti,
          insertedItems[0].id,
          trx,
        );
      }

      const newItem = insertedItems[0];

      const { data: filteredItems } = await this.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false,
        },
        trx,
      );

      let dataIndex = filteredItems.findIndex((item) => item.id === newItem.id);
      //

      if (dataIndex === -1) {
        dataIndex = 0;
      }
      const pageNumber = Math.floor(dataIndex / limit) + 1;
      const endIndex = pageNumber * limit;
      const limitedItems = filteredItems.slice(0, endIndex); // Ambil data hingga halaman yang mencakup item baru
      //

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );
      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD SCHEDULE HEADER`,
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
      throw new Error(`Error: ${error.message}`);
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

      const query = trx(`${this.tableName} as u`).select([
        'u.id as id',
        'u.nobukti',
        trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
        'u.keterangan',
        'u.modifiedby',
        trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
        trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
      ]);

      if (filters?.tglDari && filters?.tglSampai) {
        const tglDariFormatted = formatDateToSQL(String(filters?.tglDari));
        const tglSampaiFormatted = formatDateToSQL(String(filters?.tglSampai));
        query.whereBetween('u.tglbukti', [
          tglDariFormatted,
          tglSampaiFormatted,
        ]);
      }

      const excludeSearchKeys = ['tglDari', 'tglSampai'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();
        query.where((qb) => {
          searchFields.forEach((field) => {
            if (field === 'created_at' || field === 'updated_at') {
              qb.orWhereRaw(
                `TO_CHAR(u.${field}, 'DD-MM-YYYY HH24:MI:SS') LIKE ?`,
                [`%${sanitized}%`],
              );
            } else {
              qb.orWhere(`u.${field}`, 'like', `%${sanitized}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          if (key === 'tglDari' || key === 'tglSampai') {
            continue; // Lewati filter jika key adalah 'tglDari' atau 'tglSampai'
          }

          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'tglbukti') {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
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

      const result = await trx(this.tableName).count('id as total').first();
      const total = result?.total as number;
      const totalPages = Math.ceil(total / limit);

      if (sort?.sortBy && sort.sortDirection) {
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
          itemPerPage: limit,
        },
      };
    } catch (error) {
      console.error('Error fetching data schedule header in service:', error);
      throw new Error('Failed to fetch data schedule header in service');
    }
  }

  async getById(id: string, trx: any) {
    try {
      const result = await trx(this.tableName).where('id', id).first();

      if (!result) {
        throw new Error('Data not found');
      }

      return result;
    } catch (error) {
      console.error('Error fetching data by id:', error);
      throw new Error('Failed to fetch data by id');
    }
  }

  async update(id: any, data: any, trx: any) {
    try {
      data.tglbukti = formatDateToSQL(String(data?.tglbukti));

      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        method,
        details,
        ...insertedData
      } = data;
      insertedData.updated_at = this.utilsService.getTime();
      insertedData.created_at = this.utilsService.getTime();

      Object.keys(insertedData).forEach((key) => {
        if (typeof insertedData[key] === 'string') {
          insertedData[key] = insertedData[key].toUpperCase();
        }
      });

      const existingData = await trx(this.tableName).where('id', id).first();
      const hasChanges = this.utilsService.hasChanges(
        insertedData,
        existingData,
      );

      if (hasChanges) {
        insertedData.updated_at = this.utilsService.getTime();

        await trx(this.tableName).where('id', id).update(insertedData);
      }

      if (details.length > 0) {
        // Check each detail, update or set id accordingly
        const detailsWithModifiedBy = details.map((detail: any) => ({
          ...detail,
          modifiedby: insertedData.modifiedby,
        }));

        if (details.length > 0) {
          await this.scheduleDetailService.create(
            detailsWithModifiedBy,
            id,
            trx,
          );
        }
      }

      // If there are details, call the service to handle create or update
      const { data: filteredItems } = await this.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false,
        },
        trx,
      );

      let dataIndex = filteredItems.findIndex((item) => Number(item.id) === id);

      if (dataIndex === -1) {
        dataIndex = 0;
      }

      const pageNumber = Math.floor(dataIndex / limit) + 1;
      const endIndex = pageNumber * limit;

      // Ambil data hingga halaman yang mencakup item baru
      const limitedItems = filteredItems.slice(0, endIndex);

      // Simpan ke Redis
      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `EDIT SCHEDULE HEADER`,
          idtrans: id,
          nobuktitrans: id,
          aksi: 'ADD',
          datajson: JSON.stringify(data),
          modifiedby: insertedData.modifiedby,
        },
        trx,
      );

      return {
        updatedItem: {
          id,
          ...data,
        },
        pageNumber,
        dataIndex,
      };
    } catch (error) {
      throw new Error(`Error: ${error.message}`);
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

      const deletedDataDetail = await this.utilsService.lockAndDestroy(
        id,
        'scheduledetail',
        'schedule_id',
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE SCHEDULE HEADER',
          idtrans: deletedData.id,
          nobuktitrans: deletedData.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby,
        },
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE SCHEDULE DETAIL',
          idtrans: deletedDataDetail.id,
          nobuktitrans: deletedDataDetail.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedDataDetail),
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
        // const validasi = await this.globalService.checkUsed(
        //   'akunpusat',
        //   'type_id',
        //   value,
        //   trx,
        // );
        // return validasi;

        return {
          // tableName: 'tableName',
          // fieldName: 'fieldName',
          // fieldValue: 'fieldValue',
          status: 'success',
          message: 'Data aman untuk dihapus.',
        };
      }
    } catch (error) {
      console.error('Error di checkValidasi:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }

  async exportToExcel(dataHeader: any, idHeader: any) {
    const data =
      await this.scheduleDetailService.getScheduleDetailForExport(idHeader);
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

    worksheet.getCell('B5').value = 'NO. BUKTI :';
    worksheet.getCell('B6').value = 'TGL BUKTI :';
    worksheet.getCell('B7').value = 'KETERANGAN :';
    worksheet.getCell('C5').value = dataHeader.nobukti;
    worksheet.getCell('C6').value = dataHeader.tglbukti;
    worksheet.getCell('C7').value = dataHeader.keterangan;
    worksheet.getCell('C6').numFmt = 'dd-mm-yyyy';
    worksheet.getCell('C6').alignment = { horizontal: 'left' };

    // Mendefinisikan header kolom
    const headers = [
      'NO.',
      'PELAYARAN',
      'KAPAL',
      'TUJUAN KAPAL',
      'TGL BERANGKAT',
      'TGL TIBA',
      'ETB',
      'ETA',
      'ETD',
      'VOY BERANGKAT',
      'VOY TIBA',
      'CLOSING',
      'ETA TUJUAN',
      'ETD TUJUAN',
      'KETERANGAN',
    ];

    headers.forEach((header, index) => {
      const cell = worksheet.getCell(9, index + 1);
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

    data.data.forEach((row, rowIndex) => {
      const currentRow = rowIndex + 10;
      const rowValues = [
        rowIndex + 1,
        row.pelayaran_nama,
        row.kapal_nama,
        row.tujuankapal_nama,
        row.tglberangkat,
        row.tgltiba,
        row.etb,
        row.eta,
        row.etd,
        row.voyberangkat,
        row.voytiba,
        row.closing,
        row.etatujuan,
        row.etdtujuan,
        row.keterangan,
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
      `laporan_schedule_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
