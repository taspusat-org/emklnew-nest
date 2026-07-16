import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateMarketingDto } from './dto/create-marketing.dto';
// import { UpdateMarketingDto } from './dto/update-marketing.dto';
import { withUuidV7, formatDateToSQL, UtilsService  } from 'src/utils/utils.service';
import { dbHr } from 'src/common/utils/db';
import { DateTime } from 'luxon';
import * as fs from 'fs';
import * as path from 'path';
import { MarketingorderanService } from '../marketingorderan/marketingorderan.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { RedisService } from 'src/common/redis/redis.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { MarketingbiayaService } from '../marketingbiaya/marketingbiaya.service';
import { MarketingmanagerService } from '../marketingmanager/marketingmanager.service';
import { MarketingprosesfeeService } from '../marketingprosesfee/marketingprosesfee.service';
import { MarketingdetailService } from '../marketingdetail/marketingdetail.service';
import { LocksService } from '../locks/locks.service';
import { Column, Workbook } from 'exceljs';

@Injectable()
export class MarketingService {
  private readonly tableName = 'marketing';

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisService: RedisService,
    private readonly logTrailService: LogtrailService,
    private readonly utilService: UtilsService,
    private readonly locksService: LocksService,
    private readonly marketingOrderanService: MarketingorderanService,
    private readonly marketingBiayaService: MarketingbiayaService,
    private readonly marketingManagerService: MarketingmanagerService,
    private readonly marketingProsesFeeService: MarketingprosesfeeService,
    private readonly marketingDetailService: MarketingdetailService,
  ) {}

  async create(data: any, trx: any) {
    try {
      let cabang_id;
      // const time = this.utilService.getTime();
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        statusaktif_nama,
        karyawan_nama,
        statustarget_nama,
        statusbagifee_nama,
        statusfeemanager_nama,
        marketinggroup_nama,
        statusprafee_nama,
        marketingorderan,
        marketingbiaya,
        marketingmanager,
        marketingprosesfee,
        // marketingdetail,
        ...insertData
      } = data;
      insertData.updated_at = this.utilService.getTime();
      insertData.created_at = this.utilService.getTime();

      Object.keys(insertData).forEach((key) => {
        if (typeof insertData[key] === 'string') {
          const value = insertData[key];
          const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

          if (dateRegex.test(value)) {
            insertData[key] = formatDateToSQL(value);
          } else {
            insertData[key] = insertData[key].toUpperCase();
          }
        }
      });

      if (data.karyawan_id != null) {
        const cekIdCabang = await dbHr('karyawan')
          .select('id', 'namakaryawan', 'cabang_id')
          .where('id', insertData.karyawan_id)
          .first();
        const cekNamaCabang = await dbHr('cabang')
          .select('nama')
          .where('id', cekIdCabang.cabang_id)
          .first();
        const getIdCabangEmkl = await trx('cabang')
          .select('id')
          .where('nama', cekNamaCabang.nama)
          .first();
        cabang_id = getIdCabangEmkl?.id ? getIdCabangEmkl?.id : 2;
      }

      const insertDataWithCabangId = {
        ...insertData,
        cabang_id: cabang_id,
      };

      const insertNewData = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertDataWithCabangId))
        .returning('*');

      if (marketingorderan.length > 0) {
        const morderanWithMarketingId = marketingorderan.map((detail: any) => ({
          ...detail,
          marketing_id: insertNewData[0].id,
          modifiedby: insertDataWithCabangId.modifiedby,
        }));

        await this.marketingOrderanService.create(
          morderanWithMarketingId,
          insertNewData[0].id,
          trx,
        );
      }

      if (marketingbiaya.length > 0) {
        const mbiayaWithMarketingId = marketingbiaya.map((detail: any) => ({
          ...detail,
          marketing_id: insertNewData[0].id,
          modifiedby: insertDataWithCabangId.modifiedby,
        }));

        await this.marketingBiayaService.create(
          mbiayaWithMarketingId,
          insertNewData[0].id,
          trx,
        );
      }

      if (marketingmanager.length > 0) {
        const marketingManagerWithMarketingId = marketingmanager.map(
          (detail: any) => ({
            ...detail,
            marketing_id: insertNewData[0].id,
            modifiedby: insertDataWithCabangId.modifiedby,
          }),
        );
        await this.marketingManagerService.create(
          marketingManagerWithMarketingId,
          insertNewData[0].id,
          trx,
        );
      }

      if (marketingprosesfee.length > 0) {
        const mprosesfeeWithMarketingId = marketingprosesfee.map(
          (detail: any) => ({
            ...detail,
            marketing_id: insertNewData[0].id,
            modifiedby: insertDataWithCabangId.modifiedby,
          }),
        );
        await this.marketingProsesFeeService.create(
          mprosesfeeWithMarketingId,
          insertNewData[0].id,
          trx,
        );
      }

      // if (marketingdetail.length > 0) {
      //   const mdetailWithMarketingId = marketingdetail.map((detail: any) => ({
      //     ...detail,
      //     marketing_id: insertNewData[0].id,
      //     modifiedby: insertDataWithCabangId.modifiedby
      //   }))
      //
      //   await this.marketingDetailService.create(mdetailWithMarketingId, insertNewData[0].id, trx)
      // }

      const newItem = insertNewData[0];
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
      if (dataIndex === -1) {
        dataIndex = 0;
      }

      const pageNumber = Math.floor(dataIndex / limit) + 1;
      const endIndex = pageNumber * limit;
      const limitedItems = filteredItems.slice(0, endIndex); // Ambil data hingga halaman yang mencakup item baru

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );
      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD MARKETING`,
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

      const tempTableMarketingGroup = `##temp_${Math.random().toString(36).substring(2, 15)}`;
      const tempMarketingGroup = await this.utilService.createTempTable(
        'marketinggroup',
        trx,
        tempTableMarketingGroup,
      );
      await trx.raw(tempMarketingGroup);
      await trx.raw(
        `ALTER TABLE ${tempTableMarketingGroup} ADD marketinggroup_nama nvarchar(200) NULL`,
      );

      const getMarketingGroup = await trx('marketinggroup as a')
        .select([
          'a.id',
          'a.marketing_id',
          'a.statusaktif',
          'a.info',
          'a.modifiedby',
          'a.created_at',
          'a.updated_at',
          'marketing.nama as marketinggroup_nama',
        ])
        .leftJoin('marketing', 'a.marketing_id', 'marketing.id');

      const jsonString = JSON.stringify(getMarketingGroup);
      const mappingData = Object.keys(getMarketingGroup[0]).map((key) => [
        'value',
        `$.${key}`,
        key,
      ]);

      const openJson = await trx
        .from(trx.raw('OPENJSON(?)', [jsonString]))
        .jsonExtract(mappingData)
        .as('jsonData');

      await trx(tempTableMarketingGroup).insert(openJson);

      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id',
          'u.nama',
          'u.kode',
          'u.keterangan',
          'u.statusaktif',
          'u.email',
          'u.karyawan_id',
          trx.raw("TO_CHAR(u.tglmasuk, 'DD-MM-YYYY') as tglmasuk"),
          'u.cabang_id',
          'u.statustarget',
          'u.statusbagifee',
          'u.statusfeemanager',
          // 'u.marketingmanager_id',
          'u.marketinggroup_id',
          'u.statusprafee',
          'u.modifiedby',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'statusaktif.text as statusaktif_nama',
          'statusaktif.memo as memo',
          'cabang.nama as cabang_nama',
          'statustarget.text as statustarget_nama',
          'statustarget.memo as statustarget_memo',
          'statusbagifee.text as statusbagifee_nama',
          'statusbagifee.memo as statusbagifee_memo',
          'statusfeemanager.text as statusfeemanager_nama',
          'statusfeemanager.memo as statusfeemanager_memo',
          `tmg.marketinggroup_nama as marketinggroup_nama`,
          'statusprafee.text as statusprafee_nama',
          'statusprafee.memo as statusprafee_memo',
          'karyawan.nama as karyawan_nama',
        ])
        .leftJoin('parameter as statusaktif', 'u.statusaktif', 'statusaktif.id')
        .leftJoin('cabang', 'u.cabang_id', 'cabang.id')
        .leftJoin(
          'parameter as statustarget',
          'u.statustarget',
          'statustarget.id',
        )
        .leftJoin(
          'parameter as statusbagifee',
          'u.statusbagifee',
          'statusbagifee.id',
        )
        .leftJoin(
          'parameter as statusfeemanager',
          'u.statusfeemanager',
          'statusfeemanager.id',
        )
        .leftJoin(
          `${tempTableMarketingGroup} as tmg`,
          'u.marketinggroup_id',
          `tmg.id`,
        )
        // karyawan = tabel LOKAL (emkl) seperti modul yang sudah jalan
        // (penerimaanemklheader/pengeluaranemklheader/user). Inline join lintas
        // DB `hr.dbo.karyawan` melempar "Invalid object name" (Msg 208) di
        // koneksi dbMssql (HR server terpisah / tak ada linked server) → 500.
        .leftJoin('karyawan', 'u.karyawan_id', 'karyawan.id')
        .leftJoin(
          'parameter as statusprafee',
          'u.statusprafee',
          'statusprafee.id',
        );

      if (search) {
        const sanitizedValue = String(search).trim();
        query.where((builder) => {
          builder
            .orWhere('u.nama', 'ilike', `%${sanitizedValue}%`)
            .orWhere('u.kode', 'ilike', `%${sanitizedValue}%`)
            .orWhere('u.keterangan', 'ilike', `%${sanitizedValue}%`)
            .orWhere('u.email', 'ilike', `%${sanitizedValue}%`)
            .orWhere('karyawan.nama', 'ilike', `%${sanitizedValue}%`)
            .orWhereRaw("TO_CHAR(u.tglmasuk, 'DD-MM-YYYY') ILIKE ?", [
              `%${sanitizedValue}%`,
            ])
            .orWhere('cabang.nama', 'ilike', `%${sanitizedValue}%`)
            .orWhere('tmg.marketinggroup_nama', 'ilike', `%${sanitizedValue}%`)
            .orWhere('u.modifiedby', 'ilike', `%${sanitizedValue}%`)
            .orWhereRaw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
              `%${sanitizedValue}%`,
            ])
            .orWhereRaw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
              `%${sanitizedValue}%`,
            ]);
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
            } else if (key === 'tglmasuk') {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY') ILIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'karyawan_nama') {
              query.andWhereRaw('karyawan.nama ILIKE ?', [
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'cabang_nama') {
              query.andWhereRaw('cabang.nama ILIKE ?', [`%${sanitizedValue}%`]);
            } else if (key === 'marketinggroup_nama') {
              query.andWhereRaw('tmg.marketinggroup_nama ILIKE ?', [
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'statustarget_nama') {
              query.andWhere(`statustarget.id`, '=', sanitizedValue);
            } else if (key === 'statusbagifee_nama') {
              query.andWhere(`statusbagifee.id`, '=', sanitizedValue);
            } else if (key === 'statusfeemanager_nama') {
              query.andWhere(`statusfeemanager.id`, '=', sanitizedValue);
            } else if (key === 'statusprafee_nama') {
              query.andWhere(`statusprafee.id`, '=', sanitizedValue);
            } else if (key === 'statusaktif_nama') {
              query.andWhere('statusaktif.id', '=', sanitizedValue);
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
      const totalPages = Math.ceil(total / limit);
      //

      if (sort?.sortBy && sort.sortDirection) {
        if (sort?.sortBy === 'marketinggroup') {
          query.orderBy('tmg.marketinggroup_nama', sort.sortDirection);
        } else if (sort?.sortBy === 'karyawan') {
          query.orderBy('karyawan.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'cabang') {
          query.orderBy('cabang.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'statusaktif') {
          const memoExpr = '(CASE WHEN statusaktif.memo IS JSON THEN statusaktif.memo::jsonb END)';
          query.orderByRaw(
            `JSON_VALUE(${memoExpr}, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statustarget') {
          const memoExpr = '(CASE WHEN statustarget.memo IS JSON THEN statustarget.memo::jsonb END)';
          query.orderByRaw(
            `JSON_VALUE(${memoExpr}, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statusbagifee') {
          const memoExpr = '(CASE WHEN statusbagifee.memo IS JSON THEN statusbagifee.memo::jsonb END)';
          query.orderByRaw(
            `JSON_VALUE(${memoExpr}, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statusfeemanager') {
          const memoExpr = '(CASE WHEN statusfeemanager.memo IS JSON THEN statusfeemanager.memo::jsonb END)';
          query.orderByRaw(
            `JSON_VALUE(${memoExpr}, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statusprafee') {
          const memoExpr = '(CASE WHEN statusprafee.memo IS JSON THEN statusprafee.memo::jsonb END)';
          query.orderByRaw(
            `JSON_VALUE(${memoExpr}, '$.MEMO') ${sort.sortDirection}`,
          );
        } else {
          query.orderBy(sort.sortBy, sort.sortDirection);
        }
      }

      const data = await query;
      const responseType = Number(total) > 500 ? 'json' : 'local';
      //

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
      console.error('Error fetching data marketing in service:', error);
      throw new Error('Failed to fetch data marketing in service');
    }
  }

  async findAllLookupKaryawan({
    search,
    filters,
    pagination,
    isLookUp,
    sort,
  }: FindAllParams) {
    try {
      let { page, limit } = pagination ?? {};
      page = page ?? 1;
      limit = limit ?? 0;
      const offset = (page - 1) * limit;

      if (isLookUp) {
        const karyawanHrCount = await dbHr('karyawan')
          .count('id as total')
          .first();
        const totalDataKaryawanHr = karyawanHrCount?.total || 0;
        //

        if (Number(totalDataKaryawanHr) > 500) {
          return { data: { type: 'json' } };
        } else {
          limit = 0; // If ACO records are below 500, return all data
        }
      }

      const getIdStatusAktif = await dbHr('parameter')
        .select('id')
        .where('grp', '=', 'STATUS AKTIF')
        .where('text', '=', 'AKTIF')
        .first();
      const query = dbHr('karyawan')
        .select('id', 'namakaryawan', 'absen_id')
        .where('statusaktif', '=', getIdStatusAktif.id);

      if (limit > 0) {
        query.limit(limit).offset(offset);
      }

      if (search) {
        query.where((builder) => {
          builder.orWhere('namakaryawan', 'ilike', `%${search}%`);
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value) {
            query.andWhere(key, 'ilike', `%${value}%`);
          }
        }
      }

      const result = await dbHr('karyawan').count('id as total').first();
      const total = result?.total as number;
      const totalPages = Math.ceil(total / limit);
      const responseType = Number(total) > 500 ? 'json' : 'local';

      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }

      const dataLookupKaryawan = await query;

      return {
        data: dataLookupKaryawan,
        total,
        type: responseType,
        pagination: {
          currentPage: page,
          totalPages: totalPages,
          totalItems: total,
          itemsPerPage: limit,
        },
      };
    } catch (error) {
      console.error(
        'Error fetching data lookup karyawan hr in service marketing:',
        error,
        error.message,
      );
      throw new Error(
        'Failed to fetch data lookup karyawan hr in service marketing',
      );
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} marketing`;
  }

  async update(id: string, data: any, trx: any) {
    try {
      let cabang_id;
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        statusaktif_nama,
        karyawan_nama,
        statustarget_nama,
        statusbagifee_nama,
        statusfeemanager_nama,
        marketinggroup_nama,
        statusprafee_nama,
        marketingorderan,
        marketingbiaya,
        marketingmanager,
        marketingprosesfee,
        ...insertData
      } = data;
      insertData.updated_at = this.utilService.getTime();
      insertData.created_at = this.utilService.getTime();

      Object.keys(insertData).forEach((key) => {
        if (typeof insertData[key] === 'string') {
          const value = insertData[key];
          const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

          if (dateRegex.test(value)) {
            insertData[key] = formatDateToSQL(value);
          } else {
            insertData[key] = insertData[key].toUpperCase();
          }
        }
      });

      if (data.karyawan_id != null) {
        const cekIdCabang = await dbHr('karyawan')
          .select('id', 'namakaryawan', 'cabang_id')
          .where('id', insertData.karyawan_id)
          .first();
        const cekNamaCabang = await dbHr('cabang')
          .select('nama')
          .where('id', cekIdCabang.cabang_id)
          .first();
        const getIdCabangEmkl = await trx('cabang')
          .select('id')
          .where('nama', cekNamaCabang.nama)
          .first();
        cabang_id = getIdCabangEmkl?.id ? getIdCabangEmkl?.id : 26;
      }

      const insertDataWithCabangId = {
        ...insertData,
        cabang_id: cabang_id,
      };

      const existingData = await trx(this.tableName).where('id', id).first();
      const hasChanges = this.utilService.hasChanges(
        insertDataWithCabangId,
        existingData,
      );

      if (hasChanges) {
        insertDataWithCabangId.updated_at = this.utilService.getTime();

        await trx(this.tableName)
          .where('id', id)
          .update(insertDataWithCabangId);
      }

      if (marketingorderan.length > 0) {
        const morderanWithMarketingId = marketingorderan.map((detail: any) => ({
          ...detail,
          marketing_id: id,
          modifiedby: insertDataWithCabangId.modifiedby,
        }));
        await this.marketingOrderanService.create(
          morderanWithMarketingId,
          id,
          trx,
        );
      }

      if (marketingbiaya.length > 0) {
        const mbiayaWithMarketingId = marketingbiaya.map((detail: any) => ({
          ...detail,
          marketing_id: id,
          modifiedby: insertDataWithCabangId.modifiedby,
        }));
        await this.marketingBiayaService.create(mbiayaWithMarketingId, id, trx);
      }

      if (marketingmanager.length > 0) {
        const marketingManagerWithMarketingId = marketingmanager.map(
          (detail: any) => ({
            ...detail,
            marketing_id: id,
            modifiedby: insertDataWithCabangId.modifiedby,
          }),
        );
        await this.marketingManagerService.create(
          marketingManagerWithMarketingId,
          id,
          trx,
        );
      }

      if (marketingprosesfee.length > 0) {
        const mprosesfeeWithMarketingId = marketingprosesfee.map(
          (detail: any) => ({
            ...detail,
            marketing_id: id,
            modifiedby: insertDataWithCabangId.modifiedby,
          }),
        );
        await this.marketingProsesFeeService.create(
          mprosesfeeWithMarketingId,
          id,
          trx,
        );
      }

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
      const limitedItems = filteredItems.slice(0, endIndex); // Ambil data hingga halaman yang mencakup item baru

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
          modifiedby: insertData.modifiedby,
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
      const deletedData = await this.utilService.lockAndDestroy(
        id,
        this.tableName,
        'id',
        trx,
      );

      const deletedMarketingOrderan = await this.utilService.lockAndDestroy(
        id,
        'marketingorderan',
        'marketing_id',
        trx,
      );
      const deletedMarketingBiaya = await this.utilService.lockAndDestroy(
        id,
        'marketingbiaya',
        'marketing_id',
        trx,
      );
      const deletedMarketingManager = await this.utilService.lockAndDestroy(
        id,
        'marketingmanager',
        'marketing_id',
        trx,
      );
      const deletedMarketingProsesFee = await this.utilService.lockAndDestroy(
        id,
        'marketingprosesfee',
        'marketing_id',
        trx,
      );

      const cekDataeDetail = await trx('marketingdetail')
        .select('id')
        .where('marketing_id', id);

      if (cekDataeDetail?.length !== 0) {
        const deletedMarketingDetail = await this.utilService.lockAndDestroy(
          id,
          'marketingdetail',
          'marketing_id',
          trx,
        );

        await this.logTrailService.create(
          {
            namatabel: 'marketingdetail',
            postingdari: 'DELETE MARKETING DETAIL',
            idtrans: deletedMarketingDetail.id,
            nobuktitrans: deletedMarketingDetail.id,
            aksi: 'DELETE',
            datajson: JSON.stringify(deletedMarketingDetail),
            modifiedby: modifiedby,
          },
          trx,
        );
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE MARKETING',
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
          namatabel: 'marketingorderan',
          postingdari: 'DELETE MARKETING ORDERAN',
          idtrans: deletedMarketingOrderan.id,
          nobuktitrans: deletedMarketingOrderan.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedMarketingOrderan),
          modifiedby: modifiedby,
        },
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: 'marketingbiaya',
          postingdari: 'DELETE MARKETING BIAYA',
          idtrans: deletedMarketingBiaya.id,
          nobuktitrans: deletedMarketingBiaya.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedMarketingBiaya),
          modifiedby: modifiedby,
        },
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: 'marketingmanager',
          postingdari: 'DELETE MARKETING MANAGER',
          idtrans: deletedMarketingManager.id,
          nobuktitrans: deletedMarketingManager.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedMarketingManager),
          modifiedby: modifiedby,
        },
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: 'marketingprosesfee',
          postingdari: 'DELETE MARKETING PROSES FEE',
          idtrans: deletedMarketingProsesFee.id,
          nobuktitrans: deletedMarketingProsesFee.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedMarketingProsesFee),
          modifiedby: modifiedby,
        },
        trx,
      );
    } catch (error) {
      console.error('Error deleting data marketing in service:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete data marketing in service',
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
          // tableName: tableName,
          // fieldName: fieldName,
          // fieldValue: fieldValue,
          status: 'success',
          message: 'Data aman untuk dihapus.',
        };
      }
    } catch (error) {
      console.error('Error di checkValidasi:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }

  async exportToExcel(data: any[], trx: any) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    // Header laporan
    worksheet.mergeCells('A1:F1');
    worksheet.mergeCells('A2:F2');
    worksheet.mergeCells('A3:F3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN MARKETING';
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

    let currentRow = 5;

    for (const h of data) {
      const detailRes = await this.marketingOrderanService.findAll(h.id, trx, {
        search: '',
      });

      const marketingBiaya = await this.marketingBiayaService.findAll(
        h.id,
        trx,
        { search: '' },
      );

      const marketingManager = await this.marketingManagerService.findAll(
        h.id,
        trx,
        { search: '' },
      );

      const marketingProsesFee = await this.marketingProsesFeeService.findAll(
        h.id,
        trx,
        { search: '' },
      );

      const detailsMarketingOrderan = detailRes.data ?? [];
      const detailsMarketingBiaya = marketingBiaya.data ?? [];
      const detailsMarketingManager = marketingManager.data ?? [];
      const detailsMarketingProsesFee = marketingProsesFee.data ?? [];

      const headerInfo = [
        ['Nama', h.nama ?? ''],
        ['Kode', h.kode ?? ''],
        ['Keterangan', h.keterangan ?? ''],
        ['Status Aktif', h.statusaktif_nama ?? ''],
        ['Email', h.email ?? ''],
        ['Karyawan', h.karyawan_nama ?? ''],
        ['Tgl Masuk', h.tglmasuk ?? ''],
        ['Cabang', h.cabang_nama ?? ''],
        ['Status Target', h.statustarget_nama ?? ''],
        ['Status Bagi Fee', h.statusbagifee_nama ?? ''],
        ['Status Fee Manager', h.statusfeemanager_nama ?? ''],
        ['Marketing Group', h.marketinggroup_nama ?? ''],
        ['Status Pra Fee', h.statusprafee_nama ?? ''],
      ];

      headerInfo.forEach(([label, value]) => {
        worksheet.getCell(`A${currentRow}`).value = label;
        worksheet.getCell(`A${currentRow}`).font = {
          bold: true,
          name: 'Tahoma',
          size: 10,
        };
        worksheet.getCell(`B${currentRow}`).value = value;
        worksheet.getCell(`B${currentRow}`).font = { name: 'Tahoma', size: 10 };
        currentRow++;
      });

      currentRow++;

      if (detailsMarketingOrderan.length > 0) {
        worksheet.getCell(`A${currentRow}`).value = 'MARKETING ORDERAN';
        worksheet.getCell(`A${currentRow}`).font = {
          bold: true,
          name: 'Tahoma',
          size: 10,
        };

        currentRow++;
        const tableHeaders = [
          'NO.',
          'NAMA ORDERAN',
          'KETERANGAN',
          'SINGKATAN',
          'STATUS AKTIF',
        ];
        tableHeaders.forEach((header, index) => {
          const cell = worksheet.getCell(currentRow, index + 1);
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
        currentRow++;

        detailsMarketingOrderan.forEach((d: any, detailIndex: number) => {
          const rowValues = [
            detailIndex + 1,
            d.nama ?? '',
            d.keterangan ?? '',
            d.singkatan ?? '',
            d.statusaktif_nama ?? '',
          ];
          rowValues.forEach((value, colIndex) => {
            const cell = worksheet.getCell(currentRow, colIndex + 1);
            cell.value = value;
            cell.font = { name: 'Tahoma', size: 10 };

            // kolom angka rata kanan, selain itu rata kiri
            if (colIndex === 0) {
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
          currentRow++;
        });

        currentRow++;
      }

      if (detailsMarketingBiaya.length > 0) {
        worksheet.getCell(`A${currentRow}`).value = 'MARKETING BIAYA';
        worksheet.getCell(`A${currentRow}`).font = {
          bold: true,
          name: 'Tahoma',
          size: 10,
        };

        currentRow++;
        const tableHeaders = [
          'NO.',
          'JENIS BIAYA MARKETING',
          'NOMINAL',
          'STATUS AKTIF',
        ];
        tableHeaders.forEach((header, index) => {
          const cell = worksheet.getCell(currentRow, index + 1);
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
        currentRow++;

        detailsMarketingBiaya.forEach((d: any, detailIndex: number) => {
          const rowValues = [
            detailIndex + 1,
            d.jenisbiayamarketing_nama ?? '',
            d.nominal ?? '',
            d.statusaktif_nama ?? '',
          ];
          rowValues.forEach((value, colIndex) => {
            const cell = worksheet.getCell(currentRow, colIndex + 1);
            cell.value = value;
            cell.font = { name: 'Tahoma', size: 10 };

            // kolom angka rata kanan, selain itu rata kiri
            if (colIndex === 2) {
              cell.alignment = { horizontal: 'right', vertical: 'middle' };
              cell.numFmt = '#,##0.00';
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
          currentRow++;
        });

        currentRow++;
      }

      if (detailsMarketingManager.length > 0) {
        worksheet.getCell(`A${currentRow}`).value = 'MARKETING MANAGER';
        worksheet.getCell(`A${currentRow}`).font = {
          bold: true,
          name: 'Tahoma',
          size: 10,
        };

        currentRow++;
        const tableHeaders = [
          'NO.',
          'MANAGER MARKETING',
          'TGL APPROVAL',
          'STATUS APPROVAL',
          'USER APPROVAL',
          'STATUS AKTIF',
        ];
        tableHeaders.forEach((header, index) => {
          const cell = worksheet.getCell(currentRow, index + 1);
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
        currentRow++;

        detailsMarketingManager.forEach((d: any, detailIndex: number) => {
          const rowValues = [
            detailIndex + 1,
            d.managermarketing_nama ?? '',
            d.tglapproval ?? '',
            d.statusapproval_nama ?? '',
            d.userapproval ?? '',
            d.statusaktif_nama ?? '',
          ];
          rowValues.forEach((value, colIndex) => {
            const cell = worksheet.getCell(currentRow, colIndex + 1);
            cell.value = value;
            cell.font = { name: 'Tahoma', size: 10 };

            // kolom angka rata kanan, selain itu rata kiri
            if (colIndex === 0) {
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
          currentRow++;
        });

        currentRow++;
      }

      if (detailsMarketingProsesFee.length > 0) {
        worksheet.getCell(`A${currentRow}`).value = 'MARKETING PROSES FEE';
        worksheet.getCell(`A${currentRow}`).font = {
          bold: true,
          name: 'Tahoma',
          size: 10,
        };

        currentRow++;
        const tableHeaders = [
          'NO.',
          'JENIS PROSES FEE',
          'STATUS POTONG BIAYA KANTOR',
          'STATUS AKTIF',
        ];
        tableHeaders.forEach((header, index) => {
          const cell = worksheet.getCell(currentRow, index + 1);
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
        currentRow++;

        detailsMarketingProsesFee.forEach((d: any, detailIndex: number) => {
          const rowValues = [
            detailIndex + 1,
            d.jenisprosesfee_nama ?? '',
            d.statuspotongbiayakantor_nama ?? '',
            d.statusaktif_nama ?? '',
          ];
          rowValues.forEach((value, colIndex) => {
            const cell = worksheet.getCell(currentRow, colIndex + 1);
            cell.value = value;
            cell.font = { name: 'Tahoma', size: 10 };

            // kolom angka rata kanan, selain itu rata kiri
            if (colIndex === 0) {
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
          currentRow++;
        });

        currentRow++;
      }
    }

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

    worksheet.getColumn(1).width = 20;
    worksheet.getColumn(2).width = 30;

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const tempFilePath = path.resolve(
      tempDir,
      `laporan_manager_marketing${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
