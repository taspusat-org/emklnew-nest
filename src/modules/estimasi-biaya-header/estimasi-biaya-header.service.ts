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
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { EstimasiBiayaDetailBiayaService } from '../estimasi-biaya-detail-biaya/estimasi-biaya-detail-biaya.service';
import { EstimasiBiayaDetailInvoiceService } from '../estimasi-biaya-detail-invoice/estimasi-biaya-detail-invoice.service';

@Injectable()
export class EstimasiBiayaHeaderService {
  private readonly tableName: string = 'estimasibiayaheader';
  private readonly detailBiayaTableName: string = 'estimasibiayadetailbiaya';
  private readonly detailInvoiceTableName: string =
    'estimasibiayadetailInvoice';

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly detailBiayaService: EstimasiBiayaDetailBiayaService,
    private readonly detailInvoiceService: EstimasiBiayaDetailInvoiceService,
  ) {}

  async create(data: any, trx: any) {
    try {
      const created_at = this.utilsService.getTime();
      const updated_at = this.utilsService.getTime();
      const getFormatEstimasiBiayaHeader = await trx('parameter')
        .select('id', 'grp', 'subgrp')
        .where('grp', 'NOMOR ESTIMASI BIAYA')
        .where('kelompok', 'ESTIMASI BIAYA')
        .first();

      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        getFormatEstimasiBiayaHeader.grp,
        getFormatEstimasiBiayaHeader.subgrp,
        this.tableName,
        data.tglbukti,
      );

      const headerData = {
        nobukti: nomorBukti,
        tglbukti: data.tglbukti,
        jenisorder_id: data.jenisorder_id,
        orderan_nobukti: data.orderan_nobukti,
        nominal: data.nominal,
        shipper_id: data.shipper_id,
        statusppn: data.statusppn,
        asuransi_id: data.asuransi_id,
        comodity_id: data.comodity_id ? data.comodity_id : null,
        consignee_id: data.consignee_id ? data.consignee_id : null,
        modifiedby: data.modifiedby,
        created_at,
        updated_at,
      };

      Object.keys(headerData).forEach((key) => {
        if (typeof headerData[key] === 'string') {
          const value = headerData[key];
          const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

          if (dateRegex.test(value)) {
            headerData[key] = formatDateToSQL(value);
          } else {
            headerData[key] = headerData[key].toUpperCase();
          }
        }
      });

      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, headerData))
        .returning('*');
      const newItem = insertedItems[0];

      if (data.detailsbiaya && data.detailsbiaya.length > 0) {
        const detailsBiayaPayload = data.detailsbiaya.map((detail: any) => ({
          id: detail.id || 0,
          nobukti: nomorBukti,
          estimasibiaya_id: newItem.id,
          link_id: detail.link_id || null,
          biayaemkl_id: detail.biayaemkl_id || null,
          nominal: detail.nominal || '',
          nilaiasuransi: detail.nilaiasuransi || '',
          nominaldisc: detail.nominaldisc || '',
          nominalsebelumdisc: detail.nominalsebelumdisc || '',
          nominaltradoluar: detail.nominaltradoluar || '',
          modifiedby: newItem.modifiedby,
        }));

        await this.detailBiayaService.create(
          detailsBiayaPayload,
          newItem.id,
          trx,
        );
      }

      if (data.detailsinvoice && data.detailsinvoice.length > 0) {
        const detailsInvoicePayload = data.detailsinvoice.map(
          (detail: any) => ({
            id: detail.id || 0,
            nobukti: nomorBukti,
            estimasibiaya_id: newItem.id,
            link_id: detail.link_id || null,
            biayaemkl_id: detail.biayaemkl_id || null,
            nominal: detail.nominal || '',
            modifiedby: newItem.modifiedby,
          }),
        );
        await this.detailInvoiceService.create(
          detailsInvoicePayload,
          newItem.id,
          trx,
        );
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD ESTIMASI BIAYA HEADER`,
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
        'Error process approval creating estimasi biaya header in service:',
        error.message,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process approval creating estimasi biaya header in service',
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

      const query = trx
        .from(trx.raw(`${this.tableName} as u`))
        .select([
          'u.id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.jenisorder_id',
          'u.orderan_nobukti',
          'u.nominal',
          'u.shipper_id',
          'u.statusppn',
          'u.asuransi_id',
          'u.comodity_id',
          'u.consignee_id',
          'u.modifiedby',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),

          'jenisorderan.nama as jenisorder_nama',
          'shipper.nama as shipper_nama',
          'ppn.text as statusppn_nama',
          'ppn.memo as statusppn_memo',
          'asuransi.nama as asuransi_nama',
          'comodity.keterangan as comodity_nama',
          'consignee.namaconsignee as consignee_nama',
        ])
        .leftJoin('jenisorder as jenisorderan', 'u.jenisorder_id', 'jenisorderan.id')
        .leftJoin('shipper', 'u.shipper_id', 'shipper.id')
        .leftJoin('parameter as ppn', 'u.statusppn', 'ppn.id')
        .leftJoin('typeakuntansi as asuransi', 'u.asuransi_id', 'asuransi.id') //INI NANTI UBAH KALO BG DENIS UDH PUSH ASURANSI
        .leftJoin('comodity', 'u.comodity_id', 'comodity.id')
        .leftJoin('consignee', 'u.consignee_id', 'consignee.id');

      if (filters?.tglDari && filters?.tglSampai) {
        const tglDariFormatted = formatDateToSQL(String(filters?.tglDari));
        const tglSampaiFormatted = formatDateToSQL(String(filters?.tglSampai));

        query.whereBetween('u.tglbukti', [
          tglDariFormatted,
          tglSampaiFormatted,
        ]);
      }

      const excludeSearchKeys = ['tglDari', 'tglSampai', 'statusppn_text'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();
        query.where((qb) => {
          searchFields.forEach((field) => {
            if (field === 'jenisorder_text') {
              qb.orWhere(`jenisorderan.nama`, 'like', `%${sanitized}%`);
            } else if (field === 'shipper_text') {
              qb.orWhere(`shipper.nama`, 'like', `%${sanitized}%`);
            } else if (field === 'asuransi_text') {
              qb.orWhere(`asuransi.nama`, 'like', `%${sanitized}%`);
            } else if (field === 'comodity_text') {
              qb.orWhere(`comodity.keterangan`, 'like', `%${sanitized}%`);
            } else if (field === 'consignee_text') {
              qb.orWhere(`consignee.namaconsignee`, 'like', `%${sanitized}%`);
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
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          if (key === 'tglDari' || key === 'tglSampai') {
            continue;
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
            } else if (key === 'jenisorder_text') {
              query.andWhere(
                `jenisorderan.nama`,
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'shipper_text') {
              query.andWhere(`shipper.nama`, 'like', `%${sanitizedValue}%`);
            } else if (key === 'statusppn_text') {
              query.andWhere(`ppn.id`, '=', sanitizedValue);
            } else if (key === 'asuransi_text') {
              query.andWhere(`asuransi.nama`, 'like', `%${sanitizedValue}%`);
            } else if (key === 'comodity_text') {
              query.andWhere(
                `comodity.keterangan`,
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'consignee_text') {
              query.andWhere(
                `consignee.namaconsignee`,
                'like',
                `%${sanitizedValue}%`,
              );
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
        if (sort?.sortBy === 'jenisorder_text') {
          query.orderBy(`jenisorderan.nama`, sort.sortDirection);
        } else if (sort?.sortBy === 'shipper_text') {
          query.orderBy('shipper.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'statusppn_text') {
          const memoExpr = '(CASE WHEN ppn.memo IS JSON THEN ppn.memo::jsonb END)';
          query.orderByRaw(
            `JSON_VALUE(${memoExpr}, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'asuransi_text') {
          query.orderBy('asuransi.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'comodity_text') {
          query.orderBy('comodity.keterangan', sort.sortDirection);
        } else if (sort?.sortBy === 'consignee_text') {
          query.orderBy('consignee.namaconsignee', sort.sortDirection);
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
      console.error('Error to findAll Biaya Extra Header', error);
      throw new Error(error);
    }
  }

  async findOne(id: string, trx: any) {
    try {
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.jenisorder_id',
          'u.orderan_nobukti',
          'u.nominal',
          'u.shipper_id',
          'u.statusppn',
          'u.asuransi_id',
          'u.comodity_id',
          'u.consignee_id',
          'jenisorderan.nama as jenisorder_nama',
          'shipper.nama as shipper_nama',
          'ppn.text as statusppn_nama',
          'asuransi.nama as asuransi_nama',
          'comodity.keterangan as comodity_nama',
          'consignee.namaconsignee as consignee_nama',
        ])
        .leftJoin('jenisorder as jenisorderan', 'u.jenisorder_id', 'jenisorderan.id')
        .leftJoin('shipper', 'u.shipper_id', 'shipper.id')
        .leftJoin('parameter as ppn', 'u.statusppn', 'ppn.id')
        .leftJoin('typeakuntansi as asuransi', 'u.asuransi_id', 'asuransi.id')
        .leftJoin('comodity', 'u.comodity_id', 'comodity.id')
        .leftJoin('consignee', 'u.consignee_id', 'consignee.id')
        .where('u.id', id);

      const data = await query;

      const findOneDetailBiaya = await this.detailBiayaService.findOne(
        +id,
        trx,
      );
      const findOneDetailInvoice = await this.detailInvoiceService.findOne(
        +id,
        trx,
      );

      const result = {
        header: data,
        detailbiaya: findOneDetailBiaya,
        detailinvoice: findOneDetailInvoice,
      };
      console.log('result', result);
      // throw new Error('HAHA')

      return {
        data: result,
      };
    } catch (error) {
      console.error('Error fetching data estimasi biaya header by id:', error);
      throw new Error('Failed to fetch data estimasi biaya header by id');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      let updatedData;
      const updated_at = this.utilsService.getTime();
      const existingData = await trx(this.tableName).where('id', id).first();

      const headerData = {
        nobukti: data.nobukti,
        // tglbukti: data.tglbukti,
        jenisorder_id: data.jenisorder_id,
        orderan_nobukti: data.orderan_nobukti,
        nominal: data.nominal,
        shipper_id: data.shipper_id,
        statusppn: data.statusppn,
        asuransi_id: data.asuransi_id,
        comodity_id: data.comodity_id ? data.comodity_id : null,
        consignee_id: data.consignee_id ? data.consignee_id : null,
        biayaemkl_id: data.biayaemkl_id,
        keterangan: data.keterangan,
        modifiedby: data.modifiedby,
      };

      const hasChanges = this.utilsService.hasChanges(headerData, existingData);
      if (hasChanges) {
        const fixHeaderData = {
          ...headerData,
          tglbukti: data.tglbukti,
          updated_at,
        };

        Object.keys(fixHeaderData).forEach((key) => {
          if (typeof fixHeaderData[key] === 'string') {
            const value = fixHeaderData[key];
            const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

            if (dateRegex.test(value)) {
              fixHeaderData[key] = formatDateToSQL(value);
            } else {
              fixHeaderData[key] = fixHeaderData[key].toUpperCase();
            }
          }
        });

        const updated = await trx(this.tableName)
          .where('id', id)
          .update(fixHeaderData)
          .returning('*');
        updatedData = updated[0];

        await this.logTrailService.create(
          {
            namatabel: this.tableName,
            postingdari: `EDIT ESTIMASI BIAYA HEADER`,
            idtrans: updatedData.id,
            nobuktitrans: updatedData.id,
            aksi: 'ADD',
            datajson: JSON.stringify([updatedData]),
            modifiedby: updatedData.modifiedby,
          },
          trx,
        );
      }

      if (data.detailsbiaya && data.detailsbiaya.length > 0) {
        const detailsBiayaPayload = data.detailsbiaya.map((detail: any) => ({
          id: detail.id || 0,
          nobukti: updatedData
            ? updatedData.nobukti || data.nobukti
            : existingData.nobukti,
          estimasibiaya_id: updatedData ? updatedData.id : existingData.id,
          link_id: detail.link_id || null,
          biayaemkl_id: detail.biayaemkl_id || null,
          nominal: detail.nominal || '',
          nilaiasuransi: detail.nilaiasuransi || '',
          nominaldisc: detail.nominaldisc || '',
          nominalsebelumdisc: detail.nominalsebelumdisc || '',
          nominaltradoluar: detail.nominaltradoluar || '',
          modifiedby: updatedData
            ? updatedData.modifiedby
            : existingData.modifiedby,
        }));

        await this.detailBiayaService.create(detailsBiayaPayload, id, trx);
      }

      if (data.detailsinvoice && data.detailsinvoice.length > 0) {
        const detailsInvoicePayload = data.detailsinvoice.map(
          (detail: any) => ({
            id: detail.id || 0,
            nobukti: updatedData
              ? updatedData.nobukti || data.nobukti
              : existingData.nobukti,
            estimasibiaya_id: updatedData ? updatedData.id : existingData.id,
            link_id: detail.link_id || null,
            biayaemkl_id: detail.biayaemkl_id || null,
            nominal: detail.nominal || '',
            modifiedby: updatedData
              ? updatedData.modifiedby
              : existingData.modifiedby,
          }),
        );

        await this.detailInvoiceService.create(detailsInvoicePayload, id, trx);
      }

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
        (item) => String(item.id) === String(id),
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
        'Error process update estimasi biaya header in service:',
        error.message,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process update estimasi biaya header in service',
      );
    }
  }

  async delete(id: string, trx: any, modifiedby: any) {
    try {
      const checkDataDetailBiaya = await trx(this.detailBiayaTableName)
        .select('id')
        .where('estimasibiaya_id', id);
      if (checkDataDetailBiaya && checkDataDetailBiaya.length > 0) {
        for (const detail of checkDataDetailBiaya) {
          await this.detailBiayaService.delete(detail.id, trx, modifiedby);
        }
      }

      const checkDataDetailInvoice = await trx(this.detailInvoiceTableName)
        .select('id')
        .where('estimasibiaya_id', id);
      if (checkDataDetailInvoice && checkDataDetailInvoice.length > 0) {
        for (const detail of checkDataDetailInvoice) {
          await this.detailInvoiceService.delete(detail.id, trx, modifiedby);
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
          postingdari: 'DELETE ESTIMASI BIAYA HEADER',
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
      throw new InternalServerErrorException(
        'Failed to delete data estimasi biaya',
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
    const dataHeader = data.header[0];
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:H1');
    worksheet.mergeCells('A2:H2');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN ESTIMASI BIAYA';

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
    worksheet.getCell('B8').value = 'NO BUKTI ORDERAN :';
    worksheet.getCell('B9').value = 'NOMINAL :';
    worksheet.getCell('B10').value = 'SHIPPER :';
    worksheet.getCell('B11').value = 'STATUS PPN :';
    worksheet.getCell('B12').value = 'ASURANSI :';
    worksheet.getCell('B13').value = 'COMODITY :';
    worksheet.getCell('B14').value = 'CONSIGNEE :';

    worksheet.getCell('C5').value = dataHeader.nobukti;
    worksheet.getCell('C6').value = dataHeader.tglbukti;
    worksheet.getCell('C7').value = dataHeader.jenisorder_nama;
    worksheet.getCell('C8').value = dataHeader.orderan_nobukti;
    worksheet.getCell('C9').value = dataHeader.nominal;
    worksheet.getCell('C9').numFmt = '#,##0.00'; // format angka dengan ribuan
    worksheet.getCell('C9').alignment = {
      horizontal: 'right',
      vertical: 'middle',
    };
    worksheet.getCell('C10').value = dataHeader.shipper_nama;
    worksheet.getCell('C11').value = dataHeader.statusppn_nama;
    worksheet.getCell('C12').value = dataHeader.asuransi_nama;
    worksheet.getCell('C13').value = dataHeader.comodity_nama;
    worksheet.getCell('C14').value = dataHeader.consignee_nama;

    const headersDetailBiaya = [
      'NO.',
      'BIAYA EMKL',
      'LINK HARGA TRUCKING',
      'NOMINAL',
      'NILAI ASURANSI',
      'NOMINAL DISC',
      'NOMINAL SEBELUM DISC',
      'NOMINAL TRADO LUAR',
    ];

    const headersDetailInvoice = [
      'NO.',
      'BIAYA EMKL',
      'LINK HARGA TRUCKING',
      'NOMINAL',
    ];

    worksheet.getCell('A16').value = 'DETAIL BIAYA';
    worksheet.getCell('A16').font = { bold: true };

    headersDetailBiaya.forEach((header, index) => {
      const cell = worksheet.getCell(17, index + 1);
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

    data.detailbiaya.forEach((row, rowIndex) => {
      const currentRow = rowIndex + 18;
      const rowValues = [
        rowIndex + 1,
        row.biayaemkl_nama || '',
        row.link_nama || '',
        row.nominal || '',
        row.nilaiasuransi || '',
        row.nominaldisc || '',
        row.nominalsebelumdisc || '',
        row.nominaltradoluar || '',
      ];

      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);

        cell.value = value ?? '';
        cell.font = { name: 'Tahoma', size: 10 };
        // cell.alignment = {
        //   horizontal: colIndex === 0 ? 'right' : 'left',
        //   vertical: 'middle',
        // };

        if (colIndex >= 3) {
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

    worksheet.getCell('A21').value = 'DETAIL INVOICE';
    worksheet.getCell('A21').font = { bold: true };

    headersDetailInvoice.forEach((header, index) => {
      const cell = worksheet.getCell(22, index + 1);
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

    data.detailinvoice.forEach((row, rowIndex) => {
      const currentRow = rowIndex + 23;
      const rowValues = [
        rowIndex + 1,
        row.biayaemkl_nama || '',
        row.link_nama || '',
        row.nominal || '',
      ];

      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);
        cell.value = value ?? '';
        cell.font = { name: 'Tahoma', size: 10 };

        if (colIndex >= 3) {
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
      `laporan_estimasi_biaya_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
