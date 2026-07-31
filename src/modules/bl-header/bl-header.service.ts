import * as fs from 'fs';
import * as path from 'path';
import { Column, Workbook } from 'exceljs';
import { LocksService } from '../locks/locks.service';
import { GlobalService } from '../global/global.service';
import { RedisService } from 'src/common/redis/redis.service';
import { BlDetailService } from '../bl-detail/bl-detail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import {
  withUuidV7,
  formatDateToSQL,
  UtilsService,
} from 'src/utils/utils.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { BlDetailRincianService } from '../bl-detail-rincian/bl-detail-rincian.service';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { BlDetailRincianBiayaService } from '../bl-detail-rincian-biaya/bl-detail-rincian-biaya.service';

@Injectable()
export class BlHeaderService {
  private readonly tableName: string = 'blheader';

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly blDetailService: BlDetailService,
    private readonly blDetailRincianService: BlDetailRincianService,
    private readonly blDetailRincianBiayaService: BlDetailRincianBiayaService,
  ) {}

  async create(data: any, trx: any) {
    try {
      // Hanya format tanggal DD-MM-YYYY. TIDAK blanket-uppercase: schedule_id
      // (FK), id, status*, dan *_nobukti adalah UUID/kunci bertipe text
      // (case-sensitive) yang rusak bila di-uppercase; header ini tak punya
      // kolom teks manusiawi untuk di-uppercase.
      Object.keys(data).forEach((key) => {
        if (typeof data[key] === 'string') {
          const value = data[key];
          const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

          if (dateRegex.test(value)) {
            data[key] = formatDateToSQL(value);
          }
        }
      });

      const updated_at = this.utilsService.getTime();
      const created_at = this.utilsService.getTime();

      const getFormatBlHeader = await trx('parameter')
        .select('id', 'grp', 'subgrp')
        .where('grp', 'NOMOR BL')
        .where('kelompok', 'BL')
        .first();

      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        getFormatBlHeader.grp,
        getFormatBlHeader.subgrp,
        this.tableName,
        data.tglbukti,
      );

      const headerData = {
        nobukti: nomorBukti,
        tglbukti: data.tglbukti,
        schedule_id: data.schedule_id,
        statusformat: getFormatBlHeader.id,
        tglberangkat: data.tglberangkat,
        shippinginstruction_nobukti: data.shippinginstruction_nobukti,
        modifiedby: data.modifiedby,
        created_at,
        updated_at,
      };

      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, headerData))
        .returning('*');
      const newItem = insertedItems[0];

      if (data.details && data.details.length > 0) {
        const bldetail = data.details.map((detail: any) => {
          // Susun payload untuk rincian, tidak langsung set rincian mentah
          let rincianPayload: any[] = [];
          if (
            Array.isArray(detail.detailsrincian) &&
            detail.detailsrincian.length > 0
          ) {
            rincianPayload = detail.detailsrincian.map((rincian: any) => {
              let rincianBiaya = [];
              if (
                Array.isArray(rincian.rincianbiaya) &&
                rincian.rincianbiaya.length > 0
              ) {
                rincianBiaya = rincian.rincianbiaya.map((rBiaya: any) => ({
                  id: 0,
                  nobukti: newItem.nobukti,
                  bldetail_id: detail.bldetail_id || 0,
                  bldetail_nobukti: detail.bl_nobukti || '',
                  orderanmuatan_nobukti: rBiaya.orderanmuatan_nobukti,
                  nominal: rBiaya.nominal,
                  biayaemkl_id: rBiaya.biayaemkl_id,
                  info: rincian.info,
                  modifiedby: headerData.modifiedby,
                  created_at: headerData.created_at,
                  updated_at: headerData.updated_at,
                }));
              }

              return {
                id: 0,
                nobukti: newItem.nobukti,
                bldetail_id: detail.bldetail_id || 0,
                bldetail_nobukti: detail.bl_nobukti || '',
                orderanmuatan_nobukti: rincian.orderanmuatan_nobukti || '',
                keterangan: rincian.keterangan || '',
                info: rincian.info || null,
                modifiedby: headerData.modifiedby,
                created_at: headerData.created_at,
                updated_at: headerData.updated_at,
                rincianbiaya: rincianBiaya,
              };
            });
          }

          return {
            id: 0,
            nobukti: newItem.nobukti,
            bl_nobukti: detail.bl_nobukti || '',
            bl_id: newItem.id,
            keterangan: detail.keterangan || '',
            noblconecting: detail.noblconecting || '',
            shippinginstructiondetail_nobukti:
              detail.shippinginstructiondetail_nobukti || '',
            info: detail.info,
            modifiedby: headerData.modifiedby,
            created_at: headerData.created_at,
            updated_at: headerData.updated_at,
            detailsrincian: rincianPayload,
          };
        });

        await this.blDetailService.create(bldetail, newItem.id, trx);
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD BL HEADER`,
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
        'Error process approval creating bl header in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process approval creating bl header in service',
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
          trx.raw("TO_CHAR(u.tglberangkat, 'DD-MM-YYYY') as tglberangkat"),
          'u.shippinginstruction_nobukti',
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
        if (
          sort?.sortBy === 'voyberangkat' ||
          sort?.sortBy === 'tglberangkat'
        ) {
          query.orderBy(`p.${sort.sortBy}`, sort.sortDirection);
        } else if (sort?.sortBy === 'pelayaran_text') {
          query.orderBy('pel.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'kapal_text') {
          query.orderBy('kapal.nama', sort.sortDirection);
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
      console.error('Error to findAll Bl Header', error);
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
          trx.raw("TO_CHAR(u.tglberangkat, 'DD-MM-YYYY') as tglberangkat"),
          'u.shippinginstruction_nobukti',
          'u.schedule_id',
          'rincian.orderanmuatan_nobukti',
          'rincian.bldetail_nobukti',
          'orderan.nocontainer',
          'orderan.noseal',
        ])
        .leftJoin('bldetailrincian as rincian', 'u.nobukti', 'rincian.nobukti')
        .leftJoin(
          'orderanmuatan as orderan',
          'rincian.orderanmuatan_nobukti',
          'orderan.nobukti',
        )
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
      const updated_at = this.utilsService.getTime();

      // Hanya format tanggal DD-MM-YYYY. TIDAK blanket-uppercase: schedule_id
      // (FK), id, status*, dan *_nobukti adalah UUID/kunci bertipe text
      // (case-sensitive) yang rusak bila di-uppercase; header ini tak punya
      // kolom teks manusiawi untuk di-uppercase.
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
        tglberangkat: data.tglberangkat,
        shippinginstruction_nobukti: data.shippinginstruction_nobukti,
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
        const bldetail = data.details.map((detail: any) => {
          // Susun payload untuk rincian, tidak langsung set rincian mentah
          let rincianPayload: any[] = [];
          if (
            Array.isArray(detail.detailsrincian) &&
            detail.detailsrincian.length > 0
          ) {
            rincianPayload = detail.detailsrincian.map((rincian: any) => {
              let rincianBiaya = [];

              if (
                Array.isArray(rincian.rincianbiaya) &&
                rincian.rincianbiaya.length > 0
              ) {
                rincianBiaya = rincian.rincianbiaya.map((rBiaya: any) => ({
                  id: rBiaya.id,
                  nobukti: rBiaya.nobukti || updatedData.nobukti,
                  bldetail_id: rBiaya.bldetail_id || detail.bldetail_id,
                  bldetail_nobukti:
                    rBiaya.bldetail_nobukti || detail.bl_nobukti,
                  orderanmuatan_nobukti: rBiaya.orderanmuatan_nobukti,
                  nominal: rBiaya.nominal,
                  biayaemkl_id: rBiaya.biayaemkl_id,
                  info: rincian.info,
                  modifiedby: updatedData.modifiedby,
                  created_at: updatedData.created_at,
                  updated_at: updatedData.updated_at,
                }));
              }

              return {
                id: rincian.id,
                nobukti: rincian.nobukti || updatedData.nobukti,
                bldetail_id: rincian.bldetail_id || detail.bldetail_id,
                bldetail_nobukti: rincian.bldetail_nobukti || detail.bl_nobukti,
                orderanmuatan_nobukti: rincian.orderanmuatan_nobukti,
                keterangan: rincian.keterangan || '',
                info: rincian.info || null,
                modifiedby: updatedData.modifiedby,
                created_at: updatedData.created_at,
                updated_at: updatedData.updated_at,
                rincianbiaya: rincianBiaya,
              };
            });
          }

          return {
            id: detail.id || 0,
            nobukti: updatedData.nobukti,
            bl_nobukti: detail.bl_nobukti || '',
            bl_id: detail.bl_id || updatedData.id,
            keterangan: detail.keterangan || '',
            noblconecting: detail.noblconecting || '',
            shippinginstructiondetail_nobukti:
              detail.shippinginstructiondetail_nobukti || '',
            info: detail.info,
            modifiedby: updatedData.modifiedby,
            created_at: updatedData.created_at,
            updated_at: updatedData.updated_at,
            detailsrincian: rincianPayload,
          };
        });

        await this.blDetailService.create(bldetail, id, trx);
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `EDIT BL HEADER`,
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
        'Error process update bl header in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process update bl header in service',
      );
    }
  }

  async delete(id: string, trx: any, modifiedby: any) {
    try {
      const checkDataDetail = await trx('bldetail')
        .select('id')
        .where('bl_id', id);

      if (checkDataDetail && checkDataDetail.length > 0) {
        for (const detail of checkDataDetail) {
          const checkDataRincian = await trx('bldetailrincian')
            .select('id')
            .where('bldetail_id', detail.id);

          const checkDataRincianBiaya = await trx('bldetailrincianbiaya')
            .select('id')
            .where('bldetail_id', detail.id);

          if (checkDataRincian.length > 0) {
            for (const rincian of checkDataRincian) {
              await this.blDetailRincianService.delete(
                rincian.id,
                trx,
                modifiedby,
              );
            }
          }

          if (checkDataRincianBiaya.length > 0) {
            for (const rincianbiaya of checkDataRincianBiaya) {
              await this.blDetailRincianBiayaService.delete(
                rincianbiaya.id,
                trx,
                modifiedby,
              );
            }
          }
          await this.blDetailService.delete(detail.id, trx, modifiedby);
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
          postingdari: 'DELETE BL HEADER',
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

  async processBl(schedule_id: number, trx: any) {
    try {
      const query = trx
        .from(trx.raw(`shippinginstructionheader as u`))
        .select([
          'u.nobukti as shippinginstruction_nobukti',
          'p.id as shippinginstructiondetail_id',
          'p.shippinginstructiondetail_nobukti as shippinginstructiondetail_nobukti',
          'p.asalpelabuhan',
          'p.consignee',
          'p.shipper',
          'p.comodity',
          'p.notifyparty',
          'emkl.nama as emkllain_nama',
          'pel.nama as pelayaran_nama',
        ])
        .leftJoin(
          'shippinginstructiondetail as p',
          'u.id',
          'p.shippinginstruction_id',
        )
        .leftJoin('emkl', 'p.emkl_id', 'emkl.id')
        .leftJoin('pelayaran as pel', 'p.containerpelayaran_id', 'pel.id')
        .where('u.schedule_id', schedule_id);

      const data = await query;

      return {
        data,
      };
    } catch (error) {
      console.error('Error to findAll Orderan Muatan', error);
      throw new Error(error);
    }
  }

  async processBlRincianBiaya(trx: any) {
    try {
      const getIdStatusYa = await trx
        .from(trx.raw(`parameter as u`))
        .select('id')
        .where('grp', 'STATUS NILAI')
        .where('subgrp', 'STATUS NILAI')
        .where('text', 'YA')
        .first();

      const query = trx
        .from(trx.raw(`biayaemkl as u`))
        .select(['u.id', 'u.nama', 'u.keterangan', 'u.statusbiayabl'])
        .where('u.statusbiayabl', getIdStatusYa.id);

      const data = await query;

      return {
        data,
      };
    } catch (error) {
      console.error('Error to findAll Orderan Muatan', error);
      throw new Error(error);
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

  async exportToExcel(data: any, id: any) {
    const dataHeader = data.data[0];
    const workbook = new Workbook();

    // GROUP DATA JADI ARRAY DENGAN KEY BERDASARKAN BLDETAIL_NOBUKTI
    const grouped: Record<string, any[]> = data.data.reduce(
      (acc, item) => {
        if (!acc[item.bldetail_nobukti]) acc[item.bldetail_nobukti] = [];
        acc[item.bldetail_nobukti].push(item);
        return acc;
      },
      {} as Record<string, any[]>,
    );

    // Mendefinisikan header kolom
    const headers = [
      'NO.',
      'JOB',
      'NO CONT / SEAL',
      'FREIGHT',
      'SEAL PELAYARAN',
      'DOKUMEN BL',
      'OPERASIONAL',
    ];

    for (const [blDetailNo, rows] of Object.entries(grouped)) {
      const worksheet = workbook.addWorksheet(blDetailNo);

      worksheet.mergeCells('A1:G1');
      worksheet.mergeCells('A2:G2');
      worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
      worksheet.getCell('A2').value = 'BILL OF LADING';

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

      worksheet.getCell('B5').value = 'NO BL HEADER :';
      worksheet.getCell('B6').value = 'NO BL :';
      worksheet.getCell('B7').value = 'NO SHIPPING :';
      worksheet.getCell('C5').value = dataHeader.nobukti;
      worksheet.getCell('C6').value = blDetailNo;
      worksheet.getCell('C7').value = dataHeader.shippinginstruction_nobukti;

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

      rows.forEach((row, rowIndex) => {
        const currentRow = rowIndex + 10;
        const rowValues = [
          rowIndex + 1,
          row.orderanmuatan_nobukti,
          `${row.nocontainer} / ${row.noseal}`,
          '',
          '',
          '',
          '',
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
    }

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(tempDir, `laporan_BL_${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
