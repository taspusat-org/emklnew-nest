import {
  Inject,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Column, Workbook } from 'exceljs';
import { LocksService } from '../locks/locks.service';
import { GlobalService } from '../global/global.service';
import { RedisService } from 'src/common/redis/redis.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import {
  withUuidV7,
  formatDateToSQL,
  UtilsService,
} from 'src/utils/utils.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { ShippingInstructionDetailService } from '../shipping-instruction-detail/shipping-instruction-detail.service';
import { ShippingInstructionDetailRincianService } from '../shipping-instruction-detail-rincian/shipping-instruction-detail-rincian.service';
import { dbMssql } from 'src/common/utils/db';

@Injectable()
export class ShippingInstructionService {
  private readonly tableName: string = 'shippinginstructionheader';

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly shippingInstructionDetailService: ShippingInstructionDetailService,
    private readonly shippingInstructionDetailRincianService: ShippingInstructionDetailRincianService,
  ) {}

  async create(data: any, trx: any) {
    try {
      // Blanket-uppercase dihapus: schedule_id (FK), statusformat (status),
      // dan id adalah UUID bertipe text (case-sensitive) yang rusak bila
      // di-uppercase; tglbukti diformat eksplisit di bawah dan header ini tak
      // punya kolom teks manusiawi.

      const formattedTglBukti = formatDateToSQL(data.tglbukti);
      const updated_at = this.utilsService.getTime();
      const created_at = this.utilsService.getTime();

      const getFormatShipping = await trx('parameter')
        .select('id', 'grp', 'subgrp')
        .where('grp', 'NOMOR SHIPPING INSTRUCTION')
        .where('kelompok', 'SHIPPING INSTRUCTION')
        .first();

      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        getFormatShipping.grp,
        getFormatShipping.subgrp,
        this.tableName,
        String(formattedTglBukti),
      );

      const headerData = {
        nobukti: nomorBukti,
        tglbukti: formattedTglBukti,
        schedule_id: data.schedule_id,
        statusformat: getFormatShipping.id,
        modifiedby: data.modifiedby,
        created_at,
        updated_at,
      };

      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, headerData))
        .returning('*');
      const newItem = insertedItems[0];

      if (data.details && data.details.length > 0) {
        // const detailsData = details.map((detail: any) => ({
        //   ...detail,
        //   nobukti: newItem.nobukti,
        //   shippinginstruction_id: newItem.id,
        //   modifiedby: modifiedby,
        //   created_at,
        //   updated_at
        // }));

        const shippingdetail = data.details.map((detail: any) => {
          // Susun payload untuk rincian, tidak langsung set rincian mentah
          let rincianPayload: any[] = [];
          if (
            Array.isArray(detail.detailsrincian) &&
            detail.detailsrincian.length > 0
          ) {
            rincianPayload = detail.detailsrincian.map((rincian: any) => ({
              id: 0,
              nobukti: newItem.nobukti,
              shippinginstructiondetail_id: detail.id || 0,
              shippinginstructiondetail_nobukti:
                detail.shippinginstructiondetail_nobukti || '',
              orderanmuatan_nobukti: rincian.orderanmuatan_nobukti,
              comodity: rincian.comodity,
              keterangan: rincian.keterangan,
              info: rincian.info,
              modifiedby: headerData.modifiedby,
              created_at: headerData.created_at,
              updated_at: headerData.updated_at,
            }));
          }

          return {
            id: 0,
            orderan_id: detail.orderan_id,
            nobukti: newItem.nobukti,
            shippinginstructiondetail_nobukti:
              detail.shippinginstructiondetail_nobukti || '',
            tglbukti: formattedTglBukti,
            shippinginstruction_id: newItem.id,
            asalpelabuhan: detail.asalpelabuhan,
            keterangan: detail.keterangan,
            consignee: detail.consignee,
            shipper: detail.shipper,
            comodity: detail.comodity,
            notifyparty: detail.notifyparty,
            totalgw: detail.totalgw,
            emkl_id: detail.emkl_id,
            containerpelayaran_id: detail.containerpelayaran_id,
            tujuankapal_id: detail.tujuankapal_id,
            daftarbl_id: detail.daftarbl_id,
            info: detail.info,
            modifiedby: headerData.modifiedby,
            created_at: headerData.created_at,
            updated_at: headerData.updated_at,
            detailsrincian: rincianPayload,
          };
        });

        await this.shippingInstructionDetailService.create(
          shippingdetail,
          newItem.id,
          trx,
        );
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD SHIPPING INSTRUCTION HEADER`,
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
        'Error process approval creating shipping instruction in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process approval creating shipping instruction in service',
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

      const query = trx
        .from(trx.raw(`${this.tableName} as u`))
        .select([
          'u.id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.schedule_id',
          'u.modifiedby',
          trx.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
          'p.voyberangkat',
          'p.pelayaran_id',
          'pel.nama as pelayaran_nama',
          'p.kapal_id',
          'kapal.nama as kapal_nama',
          trx.raw("TO_CHAR(p.tglberangkat, 'DD-MM-YYYY') as tglberangkat"),
          'p.tujuankapal_id',
          'tujuankapal.nama as tujuankapal_nama',
        ])
        .leftJoin('schedulekapal as p', 'u.schedule_id', 'p.id')
        .leftJoin('pelayaran as pel', 'p.pelayaran_id', 'pel.id')
        .leftJoin('kapal', 'p.kapal_id', 'kapal.id')
        .leftJoin('tujuankapal', 'p.tujuankapal_id', 'tujuankapal.id');

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
            if (field === 'voyberangkat') {
              qb.orWhere(`p.voyberangkat`, 'like', `%${sanitized}%`);
            } else if (field === 'pelayaran_text') {
              qb.orWhere(`pel.nama`, 'like', `%${sanitized}%`);
            } else if (field === 'kapal_text') {
              qb.orWhere(`kapal.nama`, 'like', `%${sanitized}%`);
            } else if (field === 'tglbukti') {
              qb.orWhereRaw(`TO_CHAR(u.${field}, 'DD-MM-YYYY') LIKE ?`, [
                `%${sanitized}%`,
              ]);
            } else if (field === 'tglberangkat') {
              qb.orWhereRaw(`TO_CHAR(p.tglberangkat, 'DD-MM-YYYY') LIKE ?`, [
                `%${sanitized}%`,
              ]);
            } else if (field === 'created_at' || field === 'updated_at') {
              qb.orWhereRaw(
                `TO_CHAR(u.${field}, 'DD-MM-YYYY HH24:MI:SS') LIKE ?`,
                [`%${sanitized}%`],
              );
            } else if (field === 'tujuankapal_text') {
              qb.orWhere(`tujuankapal.nama`, 'like', `%${sanitized}%`);
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
              query.andWhereRaw(
                "TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?",
                [key, `%${sanitizedValue}%`],
              );
            } else if (key === 'tglbukti') {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'tglberangkat') {
              query.andWhereRaw(
                "TO_CHAR(p.tglberangkat, 'DD-MM-YYYY') LIKE ?",
                [`%${sanitizedValue}%`],
              );
            } else if (key === 'voyberangkat') {
              query.andWhere(`p.voyberangkat`, 'like', `%${sanitizedValue}%`);
            } else if (key === 'pelayaran_text') {
              query.andWhere(`pel.nama`, 'like', `%${sanitizedValue}%`);
            } else if (key === 'kapal_text') {
              query.andWhere(`kapal.nama`, 'like', `%${sanitizedValue}%`);
            } else if (key === 'tujuankapal_text') {
              query.andWhere(`tujuankapal.nama`, 'like', `%${sanitizedValue}%`);
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
        if (sort?.sortBy === 'voyberangkat') {
          query.orderBy('p.voyberangkat', sort.sortDirection);
        } else if (sort?.sortBy === 'pelayaran_text') {
          query.orderBy('pel.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'kapal_text') {
          query.orderBy('kapal.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'tglberangkat') {
          query.orderBy('p.tglberangkat', sort.sortDirection);
        } else if (sort?.sortBy === 'tujuankapal_text') {
          query.orderBy('tujuankapal.nama', sort.sortDirection);
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
      console.error('Error to findAll Shipping Instruction', error);
      throw new Error(error);
    }
  }

  async findOne(id: string, trx: any) {
    try {
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id',
          'u.nobukti',
          'u.schedule_id',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.modifiedby',
          trx.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
          trx.raw("TO_CHAR(p.tglberangkat, 'DD-MM-YYYY') as tglberangkat"),
          'p.kapal_id',
          'kapal.nama as kapal_nama',
        ])
        .leftJoin('schedulekapal as p', 'u.schedule_id', 'p.id')
        .leftJoin('kapal', 'p.kapal_id', 'kapal.id')
        .where('u.id', id);

      const data = await query;

      const params: FindAllParams = { search: '', filters: {} };
      const getDetail = await this.shippingInstructionDetailService.findAll(
        id,
        trx,
        params,
      );

      let mergedDetails: any[] = [];
      if (getDetail?.data && getDetail.data.length > 0) {
        mergedDetails = await Promise.all(
          getDetail.data.map(async (detail) => {
            const getRincian =
              await this.shippingInstructionDetailRincianService.findAll(
                detail.id,
                trx,
                params,
              );

            return {
              ...detail,
              rincian: getRincian.data || [], // assuming your service returns { data: [...] }
            };
          }),
        );
      }

      const result = {
        header: data,
        detail: mergedDetails, // merge details (each already has rincian)
      };

      return {
        data: result,
      };
    } catch (error) {
      console.error('Error fetching data shipping instruction by id:', error);
      throw new Error('Failed to fetch data shipping instruction by id');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      let updatedData;
      const updated_at = this.utilsService.getTime();

      // Hanya format tanggal DD-MM-YYYY. TIDAK blanket-uppercase: schedule_id
      // (FK), id, dan status* adalah UUID bertipe text (case-sensitive) yang
      // rusak bila di-uppercase; header ini tak punya kolom teks manusiawi.
      Object.keys(data).forEach((key) => {
        if (typeof data[key] === 'string') {
          const value = data[key];
          const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

          if (dateRegex.test(value)) {
            data[key] = formatDateToSQL(value);
          }
        }
      });

      const headerData = {
        nobukti: data.nobukti,
        tglbukti: data.tglbukti,
        schedule_id: data.schedule_id,
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

      if (data.details && data.details.length > 0) {
        const shippingdetail = data.details.map((detail: any) => {
          // Susun payload untuk rincian, tidak langsung set rincian mentah
          let rincianPayload: any[] = [];
          if (
            Array.isArray(detail.detailsrincian) &&
            detail.detailsrincian.length > 0
          ) {
            rincianPayload = detail.detailsrincian.map((rincian: any) => ({
              id: rincian.id || 0,
              nobukti: headerData.nobukti,
              shippinginstructiondetail_id: detail.id || 0,
              shippinginstructiondetail_nobukti:
                detail.shippinginstructiondetail_nobukti || '',
              orderanmuatan_nobukti: rincian.orderanmuatan_nobukti,
              comodity: rincian.comodity,
              keterangan: rincian.keterangan,
              info: rincian.info,
              modifiedby: headerData.modifiedby,
              updated_at: headerData.updated_at,
            }));
          }

          return {
            id: detail.id || 0,
            orderan_id: detail.orderan_id || 0,
            nobukti: headerData.nobukti,
            shippinginstructiondetail_nobukti:
              detail.shippinginstructiondetail_nobukti || '',
            tglbukti: headerData.tglbukti,
            shippinginstruction_id: id,
            asalpelabuhan: detail.asalpelabuhan,
            keterangan: detail.keterangan,
            consignee: detail.consignee,
            shipper: detail.shipper,
            comodity: detail.comodity,
            notifyparty: detail.notifyparty,
            totalgw: detail.totalgw,
            emkl_id: detail.emkl_id,
            containerpelayaran_id: detail.containerpelayaran_id,
            tujuankapal_id: detail.tujuankapal_id,
            daftarbl_id: detail.daftarbl_id,
            info: detail.info,
            modifiedby: headerData.modifiedby,
            updated_at: headerData.updated_at,
            detailsrincian: rincianPayload,
          };
        });

        await this.shippingInstructionDetailService.create(
          shippingdetail,
          id,
          trx,
        );
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `EDIT SHIPPING INSTRUCTION HEADER`,
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
        'Error process approval update shipping instruction in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process approval update shipping instruction in service',
      );
    }
  }

  async delete(id: string, trx: any, modifiedby: any) {
    try {
      const checkDataDetail = await trx('shippinginstructiondetail')
        .select('id')
        .where('shippinginstruction_id', id);
      if (checkDataDetail && checkDataDetail.length > 0) {
        for (const detail of checkDataDetail) {
          const checkDataRincian = await trx('shippinginstructiondetailrincian')
            .select('id')
            .where('shippinginstructiondetail_id', detail.id);

          if (checkDataRincian.length > 0) {
            for (const rincian of checkDataRincian) {
              await this.shippingInstructionDetailRincianService.delete(
                rincian.id,
                trx,
                modifiedby,
              );
            }
          }
          await this.shippingInstructionDetailService.delete(
            detail.id,
            trx,
            modifiedby,
          );
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
          postingdari: 'DELETE SHIPPING INSTRUCTION HEADER',
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
          status: 'success',
          message: 'Data aman untuk dihapus.',
        };
      }
    } catch (error) {
      console.error('Error di checkValidasi:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }

  // async exportToExcel(data: any, idHeader: any) {
  //   const dataHeader = data.data.header[0]
  //   const dataDetail = data.data.detail
  //   const workbook = new Workbook();
  //   const worksheet = workbook.addWorksheet('Data Export');
  //   console.log('SERVICE HEADER EXPORT', data);
  //   console.log('dataHeader', dataHeader);

  //   const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
  //   const getCabang = await dbMssql('parameter')
  //   .select(
  //     'id',
  //     'grp',
  //     dbMssql.raw(`JSON_VALUE(${memoExpr}, '$.CABANG') AS cabang`),
  //     dbMssql.raw(`JSON_VALUE(${memoExpr}, '$.CABANG_ID') AS cabang_id`),
  //   )
  //   .where('grp', 'CABANG')
  //   .first();

  //   const pelabuhan = await dbMssql('cabang')
  //   .select(
  //     'id',
  //     'pelabuhan'
  //   )
  //   .where('id', getCabang.cabang_id)
  //   .first();

  //   worksheet.mergeCells('A1:F1');
  //   worksheet.mergeCells('A2:F2');
  //   worksheet.mergeCells('A3:F3');
  //   worksheet.getCell('A1').value = 'EKSPEDISI MUATAN KAPAL LAUT';
  //   worksheet.getCell('A2').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
  //   worksheet.getCell('A3').value = `${getCabang.cabang} - ${pelabuhan.pelabuhan}`;

  //   ['A1', 'A2', 'A3'].forEach((cellKey, i) => {
  //     worksheet.getCell(cellKey).alignment = {
  //       horizontal: 'center',
  //       vertical: 'middle',
  //     };
  //     worksheet.getCell(cellKey).font = {
  //       name: 'Tahoma',
  //       size: i === 0 ? 14 : 10,
  //       bold: true,
  //     };
  //   });

  //   worksheet.getCell('B5').value = 'NO. BUKTI :';
  //   worksheet.getCell('B6').value = 'TGL BUKTI :';
  //   worksheet.getCell('B7').value = 'KETERANGAN :';
  //   worksheet.getCell('C5').value = data.nobukti;
  //   worksheet.getCell('C6').value = data.tglbukti;
  //   worksheet.getCell('C7').value = data.keterangan;
  //   worksheet.getCell('C6').numFmt = 'dd-mm-yyyy';
  //   worksheet.getCell('C6').alignment = { horizontal: 'left' };

  //   // Mendefinisikan header kolom
  //   const headers = [
  //     'NO.',
  //     'PELAYARAN',
  //     'KAPAL',
  //     'TUJUAN KAPAL',
  //     'TGL BERANGKAT',
  //     'TGL TIBA',
  //     'ETB',
  //     'ETA',
  //     'ETD',
  //     'VOY BERANGKAT',
  //     'VOY TIBA',
  //     'CLOSING',
  //     'ETA TUJUAN',
  //     'ETD TUJUAN',
  //     'KETERANGAN',
  //   ];

  //   headers.forEach((header, index) => {
  //     const cell = worksheet.getCell(9, index + 1);
  //     cell.value = header;
  //     cell.fill = {
  //       type: 'pattern',
  //       pattern: 'solid',
  //       fgColor: { argb: 'FFFF00' },
  //     };
  //     cell.font = { bold: true, name: 'Tahoma', size: 10 };
  //     cell.alignment = {
  //       horizontal: 'center',
  //       vertical: 'middle',
  //     };

  //     cell.border = {
  //       top: { style: 'thin' },
  //       left: { style: 'thin' },
  //       bottom: { style: 'thin' },
  //       right: { style: 'thin' },
  //     };
  //   });

  //   data.data.forEach((row, rowIndex) => {
  //     const currentRow = rowIndex + 10;
  //     const rowValues = [
  //       rowIndex + 1,
  //       row.pelayaran_nama,
  //       row.kapal_nama,
  //       row.tujuankapal_nama,
  //       row.tglberangkat,
  //       row.tgltiba,
  //       row.etb,
  //       row.eta,
  //       row.etd,
  //       row.voyberangkat,
  //       row.voytiba,
  //       row.closing,
  //       row.etatujuan,
  //       row.etdtujuan,
  //       row.keterangan,
  //     ];

  //     rowValues.forEach((value, colIndex) => {
  //       const cell = worksheet.getCell(currentRow, colIndex + 1);

  //       cell.value = value ?? '';
  //       cell.font = { name: 'Tahoma', size: 10 };
  //       cell.alignment = {
  //         horizontal: colIndex === 0 ? 'right' : 'left',
  //         vertical: 'middle',
  //       };
  //       cell.border = {
  //         top: { style: 'thin' },
  //         left: { style: 'thin' },
  //         bottom: { style: 'thin' },
  //         right: { style: 'thin' },
  //       };
  //     });
  //   });

  //   worksheet.columns
  //     .filter((c): c is Column => !!c)
  //     .forEach((col) => {
  //       let maxLength = 0;
  //       col.eachCell({ includeEmpty: true }, (cell) => {
  //         const cellValue = cell.value ? cell.value.toString() : '';
  //         maxLength = Math.max(maxLength, cellValue.length);
  //       });
  //       col.width = maxLength + 2;
  //     });

  //   worksheet.getColumn(1).width = 6;

  //   const tempDir = path.resolve(process.cwd(), 'tmp');
  //   if (!fs.existsSync(tempDir)) {
  //     fs.mkdirSync(tempDir, { recursive: true });
  //   }

  //   const tempFilePath = path.resolve(
  //     tempDir,
  //     `laporan_schedule_${Date.now()}.xlsx`,
  //   );
  //   await workbook.xlsx.writeFile(tempFilePath);

  //   return tempFilePath;
  // }

  async exportToExcel(data: any, id: any) {
    const workbook = new Workbook();

    const header = data.data.header[0];
    const details = data.data.detail || [];

    const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
    const getCabang = await dbMssql('parameter')
      .select(
        'id',
        'grp',
        dbMssql.raw(`JSON_VALUE(${memoExpr}, '$.CABANG') AS cabang`),
        dbMssql.raw(`JSON_VALUE(${memoExpr}, '$.CABANG_ID') AS cabang_id`),
      )
      .where('grp', 'CABANG')
      .first();

    const pelabuhan = await dbMssql('cabang')
      .select('id', 'pelabuhan')
      .where('id', getCabang.cabang_id)
      .first();

    // === Loop detail per sheet ===
    for (const [index, detail] of details.entries()) {
      // nama sheet berdasarkan no bukti (max 31 karakter biar aman)
      const sheetName = `ShippingInstruction_${index + 1}`.substring(0, 31);
      const worksheet = workbook.addWorksheet(sheetName);

      let currentRow = 2; // mulai dari A2

      // === HEADER UTAMA ===
      worksheet.mergeCells(`A${currentRow}:K${currentRow}`);
      worksheet.getCell(`A${currentRow}`).value = 'EKSPEDISI MUATAN KAPAL LAUT';
      worksheet.getCell(`A${currentRow}`).alignment = { horizontal: 'center' };
      worksheet.getCell(`A${currentRow}`).font = {
        bold: true,
        size: 12,
        name: 'Tahoma',
      };
      currentRow++;

      worksheet.mergeCells(`A${currentRow}:K${currentRow}`);
      worksheet.getCell(`A${currentRow}`).value =
        'PT. TRANSPORINDO AGUNG SEJAHTERA';
      worksheet.getCell(`A${currentRow}`).alignment = { horizontal: 'center' };
      worksheet.getCell(`A${currentRow}`).font = {
        bold: true,
        size: 10,
        name: 'Tahoma',
      };
      currentRow++;

      worksheet.mergeCells(`A${currentRow}:K${currentRow}`);
      worksheet.getCell(`A${currentRow}`).value =
        `${getCabang.cabang} - ${pelabuhan.pelabuhan}`;
      worksheet.getCell(`A${currentRow}`).alignment = { horizontal: 'center' };
      worksheet.getCell(`A${currentRow}`).font = {
        bold: true,
        size: 10,
        name: 'Tahoma',
      };
      currentRow += 2;

      worksheet.getCell(`L${currentRow}`).value = new Date().toLocaleString(
        'id-ID',
      );
      worksheet.getCell(`L${currentRow}`).font = { size: 8, name: 'Tahoma' };
      worksheet.getCell(`L${currentRow}`).alignment = { horizontal: 'right' };
      currentRow += 2;

      // === TITLE SHIPPING INSTRUCTION ===
      worksheet.mergeCells(`A${currentRow}:K${currentRow}`);
      worksheet.getCell(`A${currentRow}`).value = 'SHIPPING INSTRUCTION';
      worksheet.getCell(`A${currentRow}`).alignment = { horizontal: 'center' };
      worksheet.getCell(`A${currentRow}`).font = {
        bold: true,
        size: 11,
        name: 'Tahoma',
      };
      currentRow++;

      worksheet.mergeCells(`A${currentRow}:K${currentRow}`);
      worksheet.getCell(`A${currentRow}`).value =
        detail.shippinginstructiondetail_nobukti || '';
      worksheet.getCell(`A${currentRow}`).alignment = { horizontal: 'center' };
      worksheet.getCell(`A${currentRow}`).font = {
        bold: true,
        size: 10,
        name: 'Tahoma',
      };
      currentRow += 2;

      // === INFO UTAMA ===
      const infoRows = [
        ['SHIPPER', detail.shipper || ''],
        ['NOTIFY PARTY', detail.notifyparty || ''],
        ['CONSIGNEE', detail.consignee || ''],
        ['FEEDER', header.kapal_nama || ''],
        ['COMMODITY', detail.comodity || ''],
      ];

      infoRows.forEach(([label, val]) => {
        worksheet.getCell(`A${currentRow}`).value = label;
        worksheet.getCell(`A${currentRow}`).font = {
          bold: true,
          size: 10,
          name: 'Tahoma',
        };
        worksheet.getCell(`C${currentRow}`).value = val;
        worksheet.getCell(`C${currentRow}`).font = { size: 10, name: 'Tahoma' };
        currentRow++;
      });

      currentRow += 2;

      // === NO COUNT / SEAL ===
      worksheet.getCell(`A${currentRow}`).value = 'NO COUNT / SEAL';
      worksheet.getCell(`A${currentRow}`).font = {
        bold: true,
        size: 10,
        name: 'Tahoma',
      };
      currentRow++;

      const rincian = detail.rincian || [];
      rincian.forEach((r, i) => {
        const values = [
          i + 1,
          r.orderanmuatan_nobukti || '',
          `${r.nocontainer} / ${r.noseal}` || '',
          header.tglberangkat || '',
          r.comodity || '',
          r.keterangan || '',
        ];
        values.forEach((v, idx) => {
          const cell = worksheet.getCell(currentRow, 1 + idx);
          cell.value = v;
          cell.font = { size: 9, name: 'Tahoma' };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
        });
        currentRow++;
      });

      // === PORTS ===
      worksheet.getCell(`A${currentRow}`).value = 'PORT OF LOADING';
      worksheet.getCell(`A${currentRow}`).font = {
        bold: true,
        size: 10,
        name: 'Tahoma',
      };
      worksheet.getCell(`C${currentRow}`).value = 'TANJUNG PERAK';
      worksheet.getCell(`C${currentRow}`).font = { size: 10, name: 'Tahoma' };
      currentRow++;

      worksheet.getCell(`A${currentRow}`).value = 'PORT OF DESTINATION';
      worksheet.getCell(`A${currentRow}`).font = {
        bold: true,
        size: 10,
        name: 'Tahoma',
      };
      worksheet.getCell(`C${currentRow}`).value = detail.tujuankapal_nama || '';
      worksheet.getCell(`C${currentRow}`).font = { size: 10, name: 'Tahoma' };
      currentRow += 2;

      // === NOTE ===
      worksheet.mergeCells(`A${currentRow}:K${currentRow + 1}`);
      worksheet.getCell(`A${currentRow}`).value =
        'Note: Perhatianya agar muatan kami dipastikan sesuai data container yg telah dikirim pada Shipping Instruction, bila terdapat container lain yg dikirim tidak sesuai data Shipping Instruction, maka kami anggap yang tertera dalam data container tersebut menjadi tanggung jawab Shipping Line.';
      worksheet.getCell(`A${currentRow}`).alignment = { wrapText: true };
      worksheet.getCell(`A${currentRow}`).font = { size: 9, name: 'Tahoma' };

      worksheet.getColumn(1).width = 6;
      worksheet.getColumn(2).width = 15;
      worksheet.getColumn(3).width = 15;
      worksheet.getColumn(4).width = 15;
      worksheet.getColumn(5).width = 15;
    }

    // === SAVE FILE ===
    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const tempFilePath = path.resolve(
      tempDir,
      `shipping_instruction_${Date.now()}.xlsx`,
    );

    await workbook.xlsx.writeFile(tempFilePath);
    return tempFilePath;
  }
}
