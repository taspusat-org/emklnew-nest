import * as fs from 'fs';
import * as path from 'path';
import { Column, Workbook } from 'exceljs';
import { LocksService } from 'src/modules/locks/locks.service';
import { GlobalService } from 'src/modules/global/global.service';
import { RedisService } from 'src/common/redis/redis.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { withUuidV7, formatDateToSQL, UtilsService  } from 'src/utils/utils.service';
import { RunningNumberService } from 'src/modules/running-number/running-number.service';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { PanjarmuatandetailService } from 'src/modules/panjarmuatandetail/panjarmuatandetail.service';

@Injectable()
export class PanjarheaderService {
  private readonly tableName: string = 'panjarheader';

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly PanjarmuatandetailService: PanjarmuatandetailService,
  ) {}

  async create(data: any, trx: any) {
    try {
      let detailServiceCreate;
      // Tetap format tanggal DD-MM-YYYY. Uppercase hanya kolom teks manusiawi:
      // jenisorder_id/biayaemkl_id (FK), id, dan status* adalah UUID bertipe
      // text (case-sensitive) yang rusak bila di-uppercase.
      const upperFields = ['keterangan'];
      Object.keys(data).forEach((key) => {
        if (typeof data[key] === 'string') {
          const value = data[key];
          const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

          if (dateRegex.test(value)) {
            data[key] = formatDateToSQL(value);
          } else if (upperFields.includes(key)) {
            data[key] = value.toUpperCase();
          }
        }
      });

      const updated_at = this.utilsService.getTime();
      const created_at = this.utilsService.getTime();
      const getOrderanMuatanId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'MUATAN')
        .first();

      const getFormatPanjarHeader = await trx('parameter')
        .select('id', 'grp', 'subgrp')
        .where('grp', 'NOMOR PANJAR BIAYA')
        .where('kelompok', 'PANJAR BIAYA')
        .first();

      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        getFormatPanjarHeader.grp,
        getFormatPanjarHeader.subgrp,
        this.tableName,
        data.tglbukti,
      );

      const headerData = {
        nobukti: nomorBukti,
        tglbukti: data.tglbukti,
        jenisorder_id: data.jenisorder_id,
        biayaemkl_id: data.biayaemkl_id,
        keterangan: data.keterangan,
        statusformat: getFormatPanjarHeader.id,
        modifiedby: data.modifiedby,
        created_at,
        updated_at,
      };

      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, headerData))
        .returning('*');
      const newItem = insertedItems[0];

      switch (String(data.jenisorder_id)) {
        case getOrderanMuatanId?.id:
          detailServiceCreate = this.PanjarmuatandetailService;
          break;
        default:
          detailServiceCreate = this.PanjarmuatandetailService;
          break;
      }

      if (data.details && data.details.length > 0) {
        const detailsWithNobukti = data.details.map((detail: any) => ({
          id: detail.id || 0,
          nobukti: nomorBukti,
          panjar_id: newItem.id,
          orderanmuatan_nobukti: detail.orderanmuatan_nobukti,
          estimasi: detail.estimasi,
          nominal: detail.nominal,
          keterangan: detail.keterangan || '',
          modifiedby: newItem.modifiedby,
        }));
        await detailServiceCreate.create(detailsWithNobukti, newItem.id, trx);
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD PANJAR HEADER`,
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      const { data: filteredItems } = await this.findAll(
        {
          search: data.search,
          filters: data.filters,
          pagination: { page: data.page, limit: 0 },
          sort: { sortBy: data.sortBy, sortDirection: data.sortDirection },
          isLookUp: false,
        },
        trx,
      );

      let dataIndex = filteredItems.findIndex((item) => item.id === newItem.id);

      if (dataIndex === -1) {
        dataIndex = 0;
      }
      const pageNumber = Math.floor(dataIndex / data.limit) + 1;
      const endIndex = pageNumber * data.limit;
      const limitedItems = filteredItems.slice(0, endIndex); // Ambil data hingga halaman yang mencakup item baru
      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      return {
        newItem,
        pageNumber,
        dataIndex,
      };
    } catch (error) {
      console.error(
        'Error process approval creating panjar header in service:',
        error.message,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process approval creating panjar header in service',
      );
    }
  }

  async findAll(
    { search, filters, pagination, sort, isLookUp }: FindAllParams,
    trx: any,
  ) {
    try {
      let filtersJenisOrderan;
      let { page, limit } = pagination ?? {};
      page = page ?? 1;
      limit = limit ?? 0;

      const getOrderanMuatanId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'MUATAN')
        .first();
      if (
        filters?.jenisOrderan &&
        filters?.jenisOrderan !== null &&
        filters?.jenisOrderan !== 'null'
      ) {
        filtersJenisOrderan = filters.jenisOrderan;
      } else {
        filtersJenisOrderan = getOrderanMuatanId.id;
      }

      const query = trx
        .from(trx.raw(`${this.tableName} as u`))
        .select([
          'u.id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.jenisorder_id',
          'u.biayaemkl_id',
          'u.keterangan',
          'u.modifiedby',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'p.nama as jenisorder_nama',
          'q.nama as biayaemkl_nama',
        ])
        .leftJoin('jenisorder as p', 'u.jenisorder_id', 'p.id')
        .leftJoin('biayaemkl as q', 'u.biayaemkl_id', 'q.id')
        .where('u.jenisorder_id', filtersJenisOrderan);

      if (filters?.tglDari && filters?.tglSampai) {
        const tglDariFormatted = formatDateToSQL(String(filters?.tglDari));
        const tglSampaiFormatted = formatDateToSQL(String(filters?.tglSampai));

        query.whereBetween('u.tglbukti', [
          tglDariFormatted,
          tglSampaiFormatted,
        ]);
      }

      const excludeSearchKeys = ['tglDari', 'tglSampai', 'jenisOrderan'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();
        query.where((qb) => {
          searchFields.forEach((field) => {
            if (field === 'jenisorder_text') {
              qb.orWhere(`p.nama`, 'like', `%${sanitized}%`);
            } else if (field === 'biayaemkl_text') {
              qb.orWhere(`q.nama`, 'like', `%${sanitized}%`);
            } else if (field === 'tglbukti') {
              qb.orWhereRaw(`TO_CHAR(u.${field}, 'DD-MM-YYYY') LIKE ?`, [
                `%${sanitized}%`,
              ]);
            } else if (field === 'created_at' || field === 'updated_at') {
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
        Object.entries(filters)
          .filter(([key, value]) => !excludeSearchKeys.includes(key) && value)
          .forEach(([key, value]) => {
            const sanitizedValue = String(value).replace(/\[/g, '[[]');

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
            } else if (key === 'jenisorder_text') {
              query.andWhere(`p.nama`, 'like', `%${sanitizedValue}%`);
            } else if (key === 'biayaemkl_text') {
              query.andWhere(`q.nama`, 'like', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
            }
          });
      }

      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'jenisorder_text') {
          query.orderBy(`p.nama`, sort.sortDirection);
        } else if (sort?.sortBy === 'biayaemkl_text') {
          query.orderBy('q.nama', sort.sortDirection);
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
      console.error('Error to findAll Panjar Header', error);
      throw new Error(error);
    }
  }

  async findOne(id: string, trx: any) {
    try {
      let detailTableName;
      const checkJenisOrderId = await trx
        .from(trx.raw(`${this.tableName} as u`))
        .select('jenisorder_id')
        .where('id', id)
        .first();
      const getOrderanMuatanId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'MUATAN')
        .first();

      switch (String(checkJenisOrderId.jenisorder_id)) {
        case getOrderanMuatanId?.id:
          detailTableName = 'panjarmuatandetail';
          break;

        default:
          detailTableName = 'panjarmuatandetail';
          break;
      }

      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.jenisorder_id',
          'u.biayaemkl_id',
          'u.keterangan',
          'jenisorderan.nama as jenisorderan_nama',
          'p.nama as biayaemkl_nama',
          'detail.orderanmuatan_nobukti',
          'detail.estimasi',
          'detail.nominal',
          'detail.keterangan as keterangan_detail',
        ])
        .leftJoin('jenisorder as jenisorderan', 'u.jenisorder_id', 'jenisorderan.id')
        .leftJoin('biayaemkl as p', 'u.biayaemkl_id', 'p.id')
        .leftJoin(`${detailTableName} as detail`, 'u.id', 'detail.panjar_id')
        .where('u.id', id);

      const data = await query;
      return {
        data: data,
      };
    } catch (error) {
      console.error('Error fetching data bl header by id:', error);
      throw new Error('Failed to fetch data bl header by id');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      let updatedData;
      let detailServiceCreate;
      const updated_at = this.utilsService.getTime();
      const getOrderanMuatanId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'MUATAN')
        .first();

      // Tetap format tanggal DD-MM-YYYY. Uppercase hanya kolom teks manusiawi:
      // jenisorder_id/biayaemkl_id (FK), id, dan status* adalah UUID bertipe
      // text (case-sensitive) yang rusak bila di-uppercase.
      const upperFields = ['keterangan'];
      Object.keys(data).forEach((key) => {
        if (typeof data[key] === 'string') {
          const value = data[key];
          const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

          if (dateRegex.test(value)) {
            data[key] = formatDateToSQL(value);
          } else if (upperFields.includes(key)) {
            data[key] = value.toUpperCase();
          }
        }
      });

      const headerData = {
        nobukti: data.nobukti,
        tglbukti: data.tglbukti,
        jenisorder_id: data.jenisorder_id,
        biayaemkl_id: data.biayaemkl_id,
        keterangan: data.keterangan,
        modifiedby: data.modifiedby,
        updated_at,
      };

      const existingData = await trx(this.tableName).where('id', id).first();
      const hasChanges = this.utilsService.hasChanges(headerData, existingData);

      if (hasChanges) {
        const updated = await trx(this.tableName)
          .where('id', id)
          .update(headerData)
          .returning('*');
        updatedData = updated[0];
      }

      switch (String(data.jenisorder_id)) {
        case getOrderanMuatanId?.id:
          detailServiceCreate = this.PanjarmuatandetailService;
          break;
        default:
          detailServiceCreate = this.PanjarmuatandetailService;
          break;
      }

      if (data.details && data.details.length > 0) {
        const detailsWithNobukti = data.details.map((detail: any) => ({
          id: detail.id || 0,
          nobukti: updatedData.nobukti || data.nobukti,
          panjar_id: updatedData.id || data.id,
          orderanmuatan_nobukti: detail.orderanmuatan_nobukti,
          estimasi: detail.estimasi,
          nominal: detail.nominal,
          keterangan: detail.keterangan || '',
          modifiedby: updatedData.modifiedby,
        }));
        await detailServiceCreate.create(detailsWithNobukti, id, trx);
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `EDIT PANJAR HEADER`,
          idtrans: updatedData.id,
          nobuktitrans: updatedData.id,
          aksi: 'ADD',
          datajson: JSON.stringify([updatedData]),
          modifiedby: updatedData.modifiedby,
        },
        trx,
      );

      const { data: filteredItems } = await this.findAll(
        {
          search: data.search,
          filters: data.filters,
          pagination: { page: data.page, limit: 0 },
          sort: { sortBy: data.sortBy, sortDirection: data.sortDirection },
          isLookUp: false,
        },
        trx,
      );

      let dataIndex = filteredItems.findIndex(
        (item) => item.id === updatedData.id,
      );
      if (dataIndex === -1) {
        dataIndex = 0;
      }
      const pageNumber = Math.floor(dataIndex / data.limit) + 1;
      const endIndex = pageNumber * data.limit;
      const limitedItems = filteredItems.slice(0, endIndex); // Ambil data hingga halaman yang mencakup item baru
      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      return {
        updatedData,
        pageNumber,
        dataIndex,
      };
    } catch (error) {
      console.error(
        'Error process update panjar header in service:',
        error.message,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process update panjar header in service',
      );
    }
  }

  async delete(id: string, trx: any, modifiedby: any) {
    try {
      let detailServiceDelete;
      let detailTableName;
      const checkJenisOrderId = await trx
        .from(trx.raw(`${this.tableName} as u`))
        .select('jenisorder_id')
        .where('id', id)
        .first();
      const getOrderanMuatanId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'MUATAN')
        .first();

      switch (String(checkJenisOrderId.jenisorder_id)) {
        case getOrderanMuatanId?.id:
          detailServiceDelete = this.PanjarmuatandetailService;
          detailTableName = 'panjarmuatandetail';
          break;

        default:
          detailServiceDelete = this.PanjarmuatandetailService;
          detailTableName = 'panjarmuatandetail';
          break;
      }

      const checkDataDetail = await trx(detailTableName)
        .select('id')
        .where('panjar_id', id);
      if (checkDataDetail && checkDataDetail.length > 0) {
        for (const detail of checkDataDetail) {
          await detailServiceDelete.delete(detail.id, trx, modifiedby);
        }
      }

      const deletedData = await this.utilsService.lockAndDestroy(
        id,
        this.tableName,
        'id',
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE PANJAR HEADER',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby.toUpperCase(),
        },
        trx,
      );

      return { status: 200, message: 'Data deleted successfully', deletedData };
    } catch (error) {
      console.log('Error deleting data:', error);
      if (error instanceof HttpException) {
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
          status: 'success',
          message: 'Data aman untuk dihapus.',
        };
      }
    } catch (error) {
      console.error('Error di checkValidasi:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }

  async exportToExcel(data: any) {
    const dataHeader = data.data[0];
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:E1');
    worksheet.mergeCells('A2:E2');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN PANJAR';

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

    worksheet.getCell('B5').value = 'NO BUKTI :';
    worksheet.getCell('B6').value = 'TGL BUKTI :';
    worksheet.getCell('B7').value = 'JENIS ORDER :';
    worksheet.getCell('B8').value = 'BIAYA EMKL :';
    worksheet.getCell('B9').value = 'KETERANGAN :';

    worksheet.getCell('C5').value = dataHeader.nobukti;
    worksheet.getCell('C6').value = dataHeader.tglbukti;
    worksheet.getCell('C7').value = dataHeader.jenisorderan_nama;
    worksheet.getCell('C8').value = dataHeader.biayaemkl_nama;
    worksheet.getCell('C9').value = dataHeader.keterangan;

    const headers = [
      'NO.',
      'NO BUKTI ORDERAN',
      'ESTIMASI',
      'NOMINAL',
      'KETERANGAN',
    ];

    headers.forEach((header, index) => {
      const cell = worksheet.getCell(11, index + 1);
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
      const currentRow = rowIndex + 12;
      const rowValues = [
        rowIndex + 1,
        row.orderanmuatan_nobukti,
        row.estimasi,
        row.nominal,
        row.keterangan_detail,
      ];

      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);

        cell.value = value ?? '';
        cell.font = { name: 'Tahoma', size: 10 };
        // cell.alignment = {
        //   horizontal: colIndex === 0 ? 'right' : 'left',
        //   vertical: 'middle',
        // };

        if (colIndex === 2 || colIndex === 3 || colIndex === 5) {
          cell.value = Number(value);
          cell.numFmt = '#,##0.00'; // format angka dengan ribuan
          cell.alignment = {
            horizontal: 'right',
            vertical: 'middle',
          };
        } else if (colIndex === 0) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
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

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_biaya_extra_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
