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
  tandatanya,
  UtilsService,
 } from 'src/utils/utils.service';
import { RunningNumberService } from '../running-number/running-number.service';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { BiayaMuatanDetailService } from '../biaya-muatan-detail/biaya-muatan-detail.service';

@Injectable()
export class BiayaHeaderService {
  private readonly tableName: string = 'biayaheader';

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly biayaMuatanDetailService: BiayaMuatanDetailService,
  ) {}

  async create(data: any, trx: any) {
    try {
      let detailServiceCreate;
      let biayaExtraTableName;
      let biayaExtraDetailFieldName;
      const created_at = this.utilsService.getTime();
      const updated_at = this.utilsService.getTime();
      const getFormatBiayaHeader = await trx('parameter')
        .select('id', 'grp', 'subgrp')
        .where('grp', 'NOMOR BIAYA')
        .where('kelompok', 'BIAYA')
        .first();
      const getOrderanMuatanId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'MUATAN')
        .first();
      const getOrderanBongkaranId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'BONGKARAN')
        .first();
      const getOrderanImportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'IMPORT')
        .first();
      const getOrderanExportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'EKSPORT')
        .first();

      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        getFormatBiayaHeader.grp,
        getFormatBiayaHeader.subgrp,
        this.tableName,
        data.tglbukti,
      );

      const headerData = {
        nobukti: nomorBukti,
        tglbukti: data.tglbukti,
        jenisorder_id: data.jenisorder_id,
        biayaemkl_id: data.biayaemkl_id,
        keterangan: data.keterangan || '',
        noinvoice: data.noinvoice || '',
        relasi_id: data.relasi_id || '',
        dibayarke: data.dibayarke || '',
        biayaextra_nobukti: data.biayaextra_nobukti || '',
        statusformat: getFormatBiayaHeader.id,
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

      switch (String(data.jenisorder_id)) {
        case getOrderanMuatanId?.id:
          detailServiceCreate = this.biayaMuatanDetailService;
          biayaExtraTableName = 'biayaextramuatandetail';
          biayaExtraDetailFieldName = 'orderanmuatan_nobukti';
          break;
        // case getOrderanBongkaranId.id:
        //   detailServiceCreate = 'test';
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          detailServiceCreate = this.biayaMuatanDetailService;
          biayaExtraTableName = 'biayaextramuatandetail';
          biayaExtraDetailFieldName = 'orderanmuatan_nobukti';
          break;
      }

      if (data.details && data.details.length > 0) {
        const detailsPayload: any[] = [];

        for (const detail of data.details) {
          if (detail.biayaextra_nobuktijson) {
            const parsedJson = JSON.parse(detail.biayaextra_nobuktijson);
            for (const item of parsedJson) {
              const nominal = item.nominal;

              const updateNominalBiayaExtra = await trx(biayaExtraTableName)
                .where('nobukti', item.biayaextra_nobukti)
                .where(
                  biayaExtraDetailFieldName,
                  detail[biayaExtraDetailFieldName],
                )
                .update({ nominal })
                .returning('*');
            }
          } else {
            const nominal = detail.nominal;
            const updateNominalBiayaExtra = await trx(biayaExtraTableName)
              .where('nobukti', detail.biayaextra_nobukti)
              .where(
                biayaExtraDetailFieldName,
                detail[biayaExtraDetailFieldName],
              )
              // .where('biayaextra_id', detail.biayaextra_id)
              .update({ nominal })
              .returning('*');
          }

          detailsPayload.push({
            id: detail.id || 0,
            nobukti: newItem.nobukti,
            biaya_id: newItem.id,
            orderanmuatan_nobukti: detail.orderanmuatan_nobukti || '',
            estimasi: detail.estimasi || '',
            nominal: detail.nominal || '',
            keterangan: detail.keterangan || '',
            biayaextra_nobukti: detail.biayaextra_nobukti || '',
            biayaextra_nobuktijson: detail.biayaextra_nobuktijson || '',
            modifiedby: newItem.modifiedby,
          });
        }

        await detailServiceCreate.create(detailsPayload, newItem.id, trx);
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD BIAYA HEADER`,
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
        'Error process creating biaya header in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process creating biaya header in service',
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

      const url = 'biaya-extra-header';
      const tempUrl = `##temp_url_${Math.random().toString(36).substring(2, 8)}`;
      await trx.schema.createTable(tempUrl, (t) => {
        t.integer('id').nullable();
        t.text('link').nullable();
      });
      await trx(tempUrl).insert(
        trx
          .select(
            'u.id',
            trx.raw(`
              STRING_AGG(
                '<a target="_blank" className="link-color" href="/dashboard/${url}' + ${tandatanya} + 'biayaextra_nobukti=' + u.biayaextra_nobukti + '">' +
                '<HighlightWrapper value="' + u.biayaextra_nobukti + '" />' +
                '</a>', ','
              ) AS link
            `),
          )
          .from(`${this.tableName} as u`)
          .groupBy('u.id'),
      );

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
          'u.noinvoice',
          'u.relasi_id',
          'u.dibayarke',
          'u.biayaextra_nobukti',
          'u.modifiedby',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'tempUrl.link',
          'biayaextraheader.id as biayaextra_id',
          'jenisorderan.nama as jenisorder_nama',
          'biayaemkl.nama as biayaemkl_nama',
          'relasi.nama as relasi_nama',
        ])
        .leftJoin(`${tempUrl} as tempUrl`, 'u.id', 'tempUrl.id')
        .leftJoin(
          'biayaextraheader',
          'u.biayaextra_nobukti',
          'biayaextraheader.nobukti',
        )
        .leftJoin('jenisorder as jenisorderan', 'u.jenisorder_id', 'jenisorderan.id')
        .leftJoin('biayaemkl', 'u.biayaemkl_id', 'biayaemkl.id')
        .leftJoin('relasi', 'u.relasi_id', 'relasi.id')
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
              qb.orWhere(`jenisorderan.nama`, 'like', `%${sanitized}%`);
            } else if (field === 'biayaemkl_text') {
              qb.orWhere(`biayaemkl.nama`, 'like', `%${sanitized}%`);
            } else if (field === 'relasi_text') {
              qb.orWhere(`relasi.nama`, 'like', `%${sanitized}%`);
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
              query.andWhere(
                `jenisorderan.nama`,
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'biayaemkl_text') {
              query.andWhere(`biayaemkl.nama`, 'like', `%${sanitizedValue}%`);
            } else if (key === 'relasi_text') {
              query.andWhere(`relasi.nama`, 'like', `%${sanitizedValue}%`);
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
          query.orderBy(`jenisorderan.nama`, sort.sortDirection);
        } else if (sort?.sortBy === 'biayaemkl_text') {
          query.orderBy(`biayaemkl.nama`, sort.sortDirection);
        } else if (sort?.sortBy === 'relasi_text') {
          query.orderBy(`relasi.nama`, sort.sortDirection);
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
      let detailTableName;
      const tempBiayaExtraJson = `##temp_json_url_${Math.random().toString(36).substring(2, 8)}`;
      await trx.schema.createTable(tempBiayaExtraJson, (t) => {
        t.integer('id').nullable();
        t.string('biayaextra_nobuktijson').nullable();
      });

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
      const getOrderanBongkaranId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'BONGKARAN')
        .first();
      const getOrderanImportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'IMPORT')
        .first();
      const getOrderanExportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'EKSPORT')
        .first();

      switch (String(checkJenisOrderId.jenisorder_id)) {
        case getOrderanMuatanId?.id:
          detailTableName = 'biayamuatandetail';
          break;
        // case getOrderanBongkaranId.id:
        //   detailTableName = 'biayaextrabongkarandetail';
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          detailTableName = 'biayamuatandetail';
          break;
      }

      await trx(tempBiayaExtraJson).insert(
        trx
          .select(
            'u.id',
            trx.raw(`
            STRING_AGG(json.BIAYAEXTRA_NOBUKTI, ', ') 
            AS biayaextra_nobuktijson
          `),
          )
          .from(`${detailTableName} as u`)
          .joinRaw(
            `
          CROSS APPLY OPENJSON(u.biayaextra_nobuktijson)
          WITH (
            BIAYAEXTRA_NOBUKTI NVARCHAR(100) '$.BIAYAEXTRA_NOBUKTI'
          ) AS json
        `,
          )
          .groupBy('u.id'),
      );

      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.jenisorder_id',
          'u.biayaemkl_id',
          'u.keterangan',
          'u.noinvoice',
          'u.relasi_id',
          'u.dibayarke',
          'u.biayaextra_nobukti',
          'jenisorderan.nama as jenisorder_nama',
          'biayaemkl.nama as biayaemkl_nama',
          'relasi.nama as relasi_nama',

          'detail.orderanmuatan_nobukti as detail_orderanmuatan_nobukti',
          'detail.estimasi as detail_estimasi',
          'detail.nominal as detail_nominal',
          'detail.keterangan as detail_keterangan',
          'detail.biayaextra_nobukti as detail_biayaextra_nobukti',
          'json.biayaextra_nobuktijson',
        ])
        .leftJoin('jenisorder as jenisorderan', 'u.jenisorder_id', 'jenisorderan.id')
        .leftJoin('biayaemkl', 'u.biayaemkl_id', 'biayaemkl.id')
        .leftJoin('relasi', 'u.relasi_id', 'relasi.id')
        .leftJoin(`${detailTableName} as detail`, 'u.id', 'detail.biaya_id')
        .leftJoin(`${tempBiayaExtraJson} as json`, 'detail.id', 'json.id')
        .where('u.id', id);

      const data = await query;

      const result = {
        header: data,
        // detailbiaya: findOneDetailBiaya,
      };

      return {
        data: data,
      };
    } catch (error) {
      console.error('Error fetching data biaya header by id:', error);
      throw new Error('Failed to fetch data biaya header by id');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      let updatedData;
      let detailServiceUpdate;
      let biayaExtraTableName;
      let biayaExtraDetailFieldName;
      const updated_at = this.utilsService.getTime();
      const existingData = await trx(this.tableName).where('id', id).first();
      const getOrderanMuatanId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'MUATAN')
        .first();
      const getOrderanBongkaranId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'BONGKARAN')
        .first();
      const getOrderanImportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'IMPORT')
        .first();
      const getOrderanExportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'EKSPORT')
        .first();

      const headerData = {
        nobukti: data.nobukti,
        jenisorder_id: data.jenisorder_id,
        biayaemkl_id: data.biayaemkl_id,
        keterangan: data.keterangan,
        noinvoice: data.noinvoice,
        relasi_id: data.relasi_id,
        dibayarke: data.dibayarke,
        biayaextra_nobukti: data.biayaextra_nobukti,
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
            postingdari: `EDIT BIAYA HEADER`,
            idtrans: updatedData.id,
            nobuktitrans: updatedData.id,
            aksi: 'ADD',
            datajson: JSON.stringify([updatedData]),
            modifiedby: updatedData.modifiedby,
          },
          trx,
        );
      }

      switch (String(data.jenisorder_id)) {
        case getOrderanMuatanId?.id:
          detailServiceUpdate = this.biayaMuatanDetailService;
          biayaExtraTableName = 'biayaextramuatandetail';
          biayaExtraDetailFieldName = 'orderanmuatan_nobukti';
          break;
        // case getOrderanBongkaranId.id:
        //   detailServiceUpdate = 'test';
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          detailServiceUpdate = this.biayaMuatanDetailService;
          biayaExtraTableName = 'biayaextramuatandetail';
          biayaExtraDetailFieldName = 'orderanmuatan_nobukti';
          break;
      }

      if (data.details && data.details.length > 0) {
        const detailsPayload: any[] = [];

        for (const detail of data.details) {
          if (detail.biayaextra_nobuktijson) {
            const parsedJson = JSON.parse(detail.biayaextra_nobuktijson);
            for (const item of parsedJson) {
              const nominal = item.nominal;

              const updateNominalBiayaExtra = await trx(biayaExtraTableName)
                .where('nobukti', item.biayaextra_nobukti)
                .where(
                  biayaExtraDetailFieldName,
                  detail[biayaExtraDetailFieldName],
                )
                .update({ nominal })
                .returning('*');
            }
          } else {
            const nominal = detail.nominal;
            const updateNominalBiayaExtra = await trx(biayaExtraTableName)
              .where('nobukti', detail.biayaextra_nobukti)
              .where(
                biayaExtraDetailFieldName,
                detail[biayaExtraDetailFieldName],
              )
              .update({ nominal })
              .returning('*');
          }

          detailsPayload.push({
            id: detail.id || 0,
            nobukti: updatedData
              ? updatedData.nobukti || data.nobukti
              : existingData.nobukti,
            biaya_id: updatedData ? updatedData.id || data.id : detail.biaya_id,
            orderanmuatan_nobukti: detail.orderanmuatan_nobukti || '',
            estimasi: detail.estimasi || '',
            nominal: detail.nominal || '',
            keterangan: detail.keterangan || '',
            biayaextra_nobukti: detail.biayaextra_nobukti || '',
            biayaextra_nobuktijson: detail.biayaextra_nobuktijson || '',
            modifiedby: updatedData
              ? updatedData.modifiedby
              : headerData.modifiedby,
          });
        }

        await detailServiceUpdate.create(detailsPayload, id, trx);
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
        'Error process update biaya header in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process update biaya header in service',
      );
    }
  }

  async delete(id: string, trx: any, modifiedby: any) {
    try {
      let detailServiceDelete;
      let detailBiayaTableName;
      const checkJenisOrderId = await trx(this.tableName)
        .select('jenisorder_id')
        .where('id', id);
      const getOrderanMuatanId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'MUATAN')
        .first();
      const getOrderanBongkaranId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'BONGKARAN')
        .first();
      const getOrderanImportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'IMPORT')
        .first();
      const getOrderanExportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'EKSPORT')
        .first();

      switch (String(checkJenisOrderId.jenisorder_id)) {
        case getOrderanMuatanId?.id:
          detailServiceDelete = this.biayaMuatanDetailService;
          detailBiayaTableName = 'biayamuatandetail';
          break;
        // case getOrderanBongkaranId.id:
        //   detailServiceDelete = 'test';
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          detailServiceDelete = this.biayaMuatanDetailService;
          detailBiayaTableName = 'biayamuatandetail';
          break;
      }

      const checkDataDetailBiaya = await trx(detailBiayaTableName)
        .select('id')
        .where('biaya_id', id);
      if (checkDataDetailBiaya && checkDataDetailBiaya.length > 0) {
        for (const detail of checkDataDetailBiaya) {
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
          postingdari: 'DELETE BIAYA HEADER',
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
      throw new InternalServerErrorException('Failed to delete data biaya');
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
    console.log('data', data);

    const dataHeader = data[0];
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:H1');
    worksheet.mergeCells('A2:H2');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN BIAYA';

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
    worksheet.getCell('B10').value = 'NO INVOICE :';
    worksheet.getCell('B11').value = 'RELASI :';
    worksheet.getCell('B12').value = 'DIBAYAR KE :';
    worksheet.getCell('B13').value = 'NO BUKTI BIAYA EXTRA :';

    worksheet.getCell('C5').value = dataHeader.nobukti;
    worksheet.getCell('C6').value = dataHeader.tglbukti;
    worksheet.getCell('C7').value = dataHeader.jenisorder_nama;
    worksheet.getCell('C8').value = dataHeader.biayaemkl_nama;
    worksheet.getCell('C9').value = dataHeader.keterangan;
    worksheet.getCell('C10').value = dataHeader.noinvoice;
    worksheet.getCell('C11').value = dataHeader.relasi_nama;
    worksheet.getCell('C12').value = dataHeader.dibayarke;
    worksheet.getCell('C13').value = dataHeader.biayaextra_nobukti;

    const headers = [
      'NO.',
      'NO BUKTI ORDERAN',
      'ESTIMASI',
      'NOMINAL',
      'KETERANGAN',
      'NO BUKTI BIAYA EXTRA',
    ];

    headers.forEach((header, index) => {
      const cell = worksheet.getCell(15, index + 1);
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
      const currentRow = rowIndex + 16;
      const rowValues = [
        rowIndex + 1,
        row.detail_orderanmuatan_nobukti,
        row.detail_estimasi,
        row.detail_nominal,
        row.detail_keterangan,
        row.detail_biayaextra_nobukti
          ? row.detail_biayaextra_nobukti
          : row.biayaextra_nobuktijson,
      ];

      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);

        cell.value = value ?? '';
        cell.font = { name: 'Tahoma', size: 10 };

        if (colIndex === 2 || colIndex === 3) {
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
      `laporan_biaya_header_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
