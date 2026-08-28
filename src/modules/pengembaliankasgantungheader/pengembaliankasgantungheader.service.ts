import {
  Inject,
  Injectable,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { CreatePengembaliankasgantungheaderDto } from './dto/create-pengembaliankasgantungheader.dto';
import { UpdatePengembaliankasgantungheaderDto } from './dto/update-pengembaliankasgantungheader.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';
import { RedisService } from 'src/common/redis/redis.service';
import {
  withUuidV7,
  formatDateToSQL,
  tandatanya,
  UtilsService,
 } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { PengembaliankasgantungdetailService } from '../pengembaliankasgantungdetail/pengembaliankasgantungdetail.service';
import { Column, Workbook } from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PenerimaanheaderService } from '../penerimaanheader/penerimaanheader.service';
import { GlobalService } from '../global/global.service';
import { LocksService } from '../locks/locks.service';
@Injectable()
export class PengembaliankasgantungheaderService {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly pengembaliankasgantungdetailService: PengembaliankasgantungdetailService,
    private readonly penerimaanheaderService: PenerimaanheaderService,
    private readonly globalService: GlobalService,
    private readonly locksService: LocksService,
  ) {}
  private readonly tableName = 'pengembaliankasgantungheader';
  async create(data: any, trx: any) {
    try {
      data.tglbukti = formatDateToSQL(String(data?.tglbukti)); // Fungsi untuk format
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        relasi_nama,
        bank_nama,
        details,
        ...insertData
      } = data;
      insertData.updated_at = this.utilsService.getTime();
      insertData.created_at = this.utilsService.getTime();
      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['nobukti', 'keterangan'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });
      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)'; // penting: TEXT/NTEXT -> text
      const parameterCabang = await trx('parameter')
        .select(trx.raw(`JSON_VALUE(${memoExpr}, '$.CABANG_ID') AS cabang_id`))
        .where('grp', 'CABANG')
        .andWhere('subgrp', 'CABANG')
        .first();
      const formatpenerimaangantung = await trx(`bank as b`)
        .select('p.grp', 'p.subgrp', 'b.formatpenerimaangantung', 'b.coa')
        .leftJoin('parameter as p', 'p.id', 'b.formatpenerimaangantung')
        .where('b.id', insertData.bank_id)
        .first();
      const parameter = await trx('parameter')
        .select(
          'grp',
          'subgrp',
          trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
          trx.raw(`JSON_VALUE(${memoExpr}, '$.COA') AS coa_nama`),
        )
        .where('id', formatpenerimaangantung.formatpenerimaangantung)
        .first();

      const cabangId = parameterCabang.cabang_id;

      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        formatpenerimaangantung.grp,
        formatpenerimaangantung.subgrp,
        this.tableName,
        insertData.tglbukti,
        cabangId,
      );
      insertData.nobukti = nomorBukti;

      const detailPenerimaan = details.map((detail: any) => ({
        ...detail,
        coa: parameter.coa_nama,
        pengembaliankasgantung_nobukti: nomorBukti,
        modifiedby: data.modifiedby,
      }));
      const dataPenerimaan = {
        tglbukti: insertData.tglbukti,
        keterangan: insertData.keterangan,
        bank_id: insertData.bank_id,
        relasi_id: insertData.relasi_id,
        alatbayar_id: insertData.alatbayar_id,
        postingdari: parameter.memo_nama,
        coakasmasuk: insertData.coakasmasuk,
        modifiedby: data.modifiedby,
        details: detailPenerimaan,
      };
      const insertPenerimaan = await this.penerimaanheaderService.create(
        dataPenerimaan,
        trx,
      );
      insertData.penerimaan_nobukti = insertPenerimaan.newItem.nobukti;
      insertData.statusformat = formatpenerimaangantung.formatpenerimaangantung;
      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');
      if (details.length > 0) {
        // Inject nobukti into each detail item
        const detailsWithNobukti = details.map(
          (detail: any, index: number) => ({
            ...detail,
            nobukti: nomorBukti, // Inject nobukti into each detail
            kasgantung_nobukti: detail.nobukti, // Ensure kasgantung_nobukti is preserved
            modifiedby: data.modifiedby, // Ensure modifiedby is preserved
            penerimaandetail_id: insertPenerimaan.dataDetail.data[index].id,
          }),
        );

        // Pass the updated details with nobukti to the detail creation service
        await this.pengembaliankasgantungdetailService.create(
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
          isLookUp: false, // Set based on your requirement (e.g., lookup flag)
        },
        trx,
      );
      const dataDetail = await this.pengembaliankasgantungdetailService.findAll(
        newItem.id,
        trx,
      );

      // Cari index item baru di hasil yang sudah difilter
      let itemIndex = filteredItems.findIndex(
        (item) => Number(item.id) === newItem.id,
      );

      if (itemIndex === -1) {
        itemIndex = 0;
      }

      const pageNumber = Math.floor(itemIndex / limit) + 1;
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
          postingdari: `ADD PENGEMBALIAN KAS GANTUNG HEADER`,
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
        itemIndex,
        dataDetail,
      };
    } catch (error) {
      console.error(error);
      throw new Error(`Error: ${error.message}`);
    }
  }
  async update(id: any, data: any, trx: any) {
    try {
      data.tglbukti = formatDateToSQL(String(data?.tglbukti)); // Fungsi untuk format

      const {
        sortBy,
        sortDirection,
        coakasmasuk_nama,
        filters,
        search,
        page,
        limit,
        relasi_nama,
        bank_nama,
        details,
        ...insertData
      } = data;
      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['nobukti', 'keterangan'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });
      const formatpenerimaangantung = await trx(`bank as b`)
        .select('p.grp', 'p.subgrp', 'b.formatpenerimaangantung', 'b.coa')
        .leftJoin('parameter as p', 'p.id', 'b.formatpenerimaangantung')
        .where('b.id', insertData.bank_id)
        .first();
      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)'; // penting: TEXT/NTEXT -> text
      const parameter = await trx('parameter')
        .select(
          'grp',
          'subgrp',
          trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
          trx.raw(`JSON_VALUE(${memoExpr}, '$.COA') AS coa_nama`),
        )
        .where('id', formatpenerimaangantung.formatpenerimaangantung)
        .first();
      const existingData = await trx(this.tableName).where('id', id).first();
      const penerimaanData = await trx('penerimaanheader')
        .where('nobukti', existingData.penerimaan_nobukti)
        .first();
      const hasChanges = this.utilsService.hasChanges(insertData, existingData);

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();

        await trx(this.tableName).where('id', id).update(insertData);
      }
      const detailPenerimaan = details.map((detail: any) => {
        // Destructuring the detail object and removing penerimaandetail_id
        const { penerimaandetail_id, ...rest } = detail;

        return {
          ...rest, // Spread the remaining properties
          id: penerimaandetail_id, // Replace id with penerimaandetail_id
          pengembaliankasgantung_nobukti: existingData.nobukti,
          coa: parameter.coa_nama,
          modifiedby: data.modifiedby,
        };
      });

      const dataPenerimaan = {
        keterangan: insertData.keterangan,
        relasi_id: insertData.relasi_id,
        bank_id: insertData.bank_id,
        alatbayar_id: insertData.alatbayar_id,
        tglbukti: formatDateToSQL(existingData.tglbukti),
        modifiedby: data.modifiedby,
        details: detailPenerimaan,
      };

      const updatedPenerimaan = await this.penerimaanheaderService.update(
        penerimaanData.id,
        dataPenerimaan,
        trx,
      );

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();

        await trx(this.tableName).where('id', id).update(insertData);
      }
      // Check each detail, update or set id accordingly
      if (details.length >= 0) {
        const existingDetails = await trx('pengembaliankasgantungdetail').where(
          'pengembaliankasgantung_id',
          id,
        );
        const updatedDetails = details.map((detail: any) => {
          const existingDetail = existingDetails.find(
            (existing: any) => existing.nobukti === detail.nobukti,
          );

          if (existingDetail) {
            // If the nobukti exists, assign the id from the existing record
            detail.id = existingDetail.id;
            detail.kasgantung_nobukti = detail.nobukti; // Ensure nobukti is preserved
            detail.nobukti = existingData.nobukti; // Ensure nobukti is preserved
            detail.modifiedby = data.modifiedby; // Ensure modifiedby is preserved
          } else {
            // If nobukti does not exist, set id to 0
            detail.id = 0;
            detail.kasgantung_nobukti = detail.nobukti; // Ensure nobukti is preserved
            detail.nobukti = existingData.nobukti; // Ensure nobukti is preserved
            detail.modifiedby = data.modifiedby; // Ensure modifiedby is preserved
          }

          return detail;
        });
        await this.pengembaliankasgantungdetailService.create(
          updatedDetails,
          id,
          trx,
        );
      }

      // If there are details, call the service to handle create or update

      const { data: filteredItems } = await this.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false, // Set based on your requirement (e.g., lookup flag)
        },
        trx,
      );

      const dataDetail = await this.pengembaliankasgantungdetailService.findAll(
        id,
        trx,
      );

      // Cari index item baru di hasil yang sudah difilter
      let itemIndex = filteredItems.findIndex((item) => Number(item.id) === id);

      if (itemIndex === -1) {
        itemIndex = 0;
      }

      const pageNumber = Math.floor(itemIndex / limit) + 1;
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
          postingdari: `ADD PENGEMBALIAN KAS GANTUNG HEADER`,
          idtrans: id,
          nobuktitrans: id,
          aksi: 'ADD',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      return {
        updatedItem: {
          id,
          ...data,
        },
        pageNumber,
        itemIndex,
        dataDetail,
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
        const acoCountResult = await trx(this.tableName)
          .count('id as total')
          .first();

        const acoCount = acoCountResult?.total || 0;

        if (Number(acoCount) > 500) {
          return { data: { type: 'json' } };
        } else {
          limit = 0;
        }
      }
      const tempUrl = `##temp_url_${Math.random().toString(36).substring(2, 8)}`;

      await trx.schema.createTable(tempUrl, (t) => {
        t.integer('id').nullable();
        t.string('penerimaan_nobukti').nullable();
        t.text('link').nullable();
      });
      const url = 'penerimaan';

      await trx(tempUrl).insert(
        trx
          .select(
            'u.id',
            'u.penerimaan_nobukti',
            trx.raw(`
              STRING_AGG(
                '<a target="_blank" className="link-color" href="/dashboard/${url}' + ${tandatanya} + 'penerimaan_nobukti=' + u.penerimaan_nobukti + '">' +
                '<HighlightWrapper value="' + u.penerimaan_nobukti + '" />' +
                '</a>', ','
              ) AS link
            `),
          )
          .from(this.tableName + ' as u')
          .groupBy('u.id', 'u.penerimaan_nobukti'),
      );
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.nobukti', // nobukti (nvarchar(100))
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.keterangan', // keterangan (text)
          'u.bank_id', // bank_id (integer)
          'u.penerimaan_nobukti', // penerimaan_nobukti (nvarchar(100))
          'u.coakasmasuk', // coakasmasuk (nvarchar(100))
          'u.relasi_id', // relasi_id (integer)
          'u.info', // info (text)
          'u.modifiedby', // modifiedby (varchar(200))
          'ap.keterangancoa as coakasmasuk_nama',
          trx.raw('r.nama as relasi_nama'), // relasi_nama (text)
          trx.raw('b.nama as bank_nama'),
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"), // created_at (datetime)
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"), // updated_at (datetime)
          'tempUrl.link',
        ])
        .leftJoin(
          trx.raw(`${tempUrl} as tempUrl`),
          'u.penerimaan_nobukti',
          'tempUrl.penerimaan_nobukti',
        )
        .leftJoin('relasi as r', 'u.relasi_id', 'r.id')
        .leftJoin('bank as b', 'u.bank_id', 'b.id')
        .leftJoin('akunpusat as ap', 'u.coakasmasuk', 'ap.coa');
      if (filters?.tglDari && filters?.tglSampai) {
        // Mengonversi tglDari dan tglSampai ke format yang diterima SQL (YYYY-MM-DD)
        const tglDariFormatted = formatDateToSQL(String(filters?.tglDari)); // Fungsi untuk format
        const tglSampaiFormatted = formatDateToSQL(String(filters?.tglSampai));

        // Menggunakan whereBetween dengan tanggal yang sudah diformat
        query.whereBetween('u.tglbukti', [
          tglDariFormatted,
          tglSampaiFormatted,
        ]);
      }
      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }
      const excludeSearchKeys = ['tglDari', 'tglSampai'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k) && filters![k],
      );
      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            qb.orWhere(`u.${field}`, 'like', `%${sanitized}%`);
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
            if (
              key === 'created_at' ||
              key === 'updated_at' ||
              key === 'editing_at'
            ) {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'relasi_nama') {
              query.andWhere('r.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'bank_nama') {
              query.andWhere('b.nama', 'like', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }

      const result = await trx(this.tableName).count('id as total').first();
      const total = result?.total as number;
      const totalPages = Math.ceil(total / limit);

      if (sort?.sortBy && sort?.sortDirection) {
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
          itemsPerPage: limit,
        },
      };
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }
  async findAllReport(
    { search, filters, pagination, sort, isLookUp }: FindAllParams,
    trx: any,
  ) {
    try {
      let { page, limit } = pagination ?? {};

      page = page ?? 1;
      limit = limit ?? 0;

      if (isLookUp) {
        const acoCountResult = await trx(this.tableName)
          .count('id as total')
          .first();

        const acoCount = acoCountResult?.total || 0;

        if (Number(acoCount) > 500) {
          return { data: { type: 'json' } };
        } else {
          limit = 0;
        }
      }

      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.nobukti', // nobukti (nvarchar(100))
          'u.tglbukti', // tglbukti (date)
          'u.keterangan', // keterangan (text)
          'u.bank_id', // bank_id (integer)
          'u.penerimaan_nobukti', // penerimaan_nobukti (nvarchar(100))
          'u.coakasmasuk', // coakasmasuk (nvarchar(100))
          'u.relasi_id', // relasi_id (integer)
          'u.info', // info (text)
          'u.modifiedby', // modifiedby (varchar(200))
          'ap.keterangancoa as coakasmasuk_nama',
          trx.raw('r.nama as relasi_nama'), // relasi_nama (text)
          trx.raw('b.nama as bank_nama'),
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"), // created_at (datetime)
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"), // updated_at (datetime)
        ])
        .leftJoin('relasi as r', 'u.relasi_id', 'r.id')
        .leftJoin('bank as b', 'u.bank_id', 'b.id')
        .leftJoin('akunpusat as ap', 'u.coakasmasuk', 'ap.coa');

      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      if (search) {
        const sanitizedValue = String(search).replace(/\[/g, '[[]');
        query.where((builder) => {
          builder
            .orWhere('u.nobukti', 'like', `%${sanitizedValue}%`)
            .orWhere('u.keterangan', 'like', `%${sanitizedValue}%`)
            .orWhere('u.penerimaan_nobukti', 'like', `%${sanitizedValue}%`)
            .orWhere('u.coakasmasuk', 'like', `%${sanitizedValue}%`)
            .orWhere('u.info', 'like', `%${sanitizedValue}%`);
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');
          if (value) {
            if (
              key === 'created_at' ||
              key === 'updated_at' ||
              key === 'editing_at'
            ) {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }
      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }
      const data: Array<any> = await query;
      const headerIds = data.map((h) => h.id);

      // 2) Jika tidak ada header, langsung return dengan details kosong
      if (headerIds.length === 0) {
        return {
          data: data.map((h) => ({ ...h, details: [] })),
          type: Number(data.length) > 500 ? 'json' : 'local',
          total: data.length,
          pagination: {
            /* ... */
          },
        };
      }

      // 3) Ambil semua detail yang terhubung ke header-header tersebut
      const detailRows = await trx('pengembaliankasgantungdetail')
        .select([
          'id',
          'pengembaliankasgantung_id',
          'nobukti',
          'kasgantung_nobukti',
          'keterangan',
          'nominal',
          'info',
          'modifiedby',
          'editing_by',
          trx.raw("TO_CHAR(editing_at, 'DD-MM-YYYY HH24:MI:SS') as editing_at"),
          trx.raw("TO_CHAR(created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
        ])
        .whereIn('pengembaliankasgantung_id', headerIds);

      // 4) Group detail berdasarkan pengembaliankasgantung_id
      const detailsByHeader = detailRows.reduce(
        (acc, detail) => {
          const key = detail.pengembaliankasgantung_id;
          if (!acc[key]) acc[key] = [];
          acc[key].push(detail);
          return acc;
        },
        {} as Record<number, Array<any>>,
      );

      // 5) Satukan: tiap header dapat array details (atau [] jika tidak ada)
      const dataWithDetails = data.map((h) => ({
        ...h,
        details: detailsByHeader[h.id] || [],
      }));

      // 6) Hitung total & pagination seperti sebelumnya
      const resultCount = await trx(this.tableName)
        .count('id as total')
        .first();
      const total = Number(resultCount?.total || 0);
      const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

      return {
        data: dataWithDetails,
        type: total > 500 ? 'json' : 'local',
        total,
        pagination: {
          currentPage: page,
          totalPages: totalPages,
          totalItems: total,
          itemsPerPage: limit,
        },
      };
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async findOne(
    { search, filters, pagination, sort }: FindAllParams,
    id: string,
    trx: any,
  ) {
    try {
      let { page, limit } = pagination ?? {};

      page = page ?? 1;
      limit = limit ?? 0;

      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.nobukti', // nobukti (nvarchar(100))
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.keterangan', // keterangan (text)
          'u.bank_id', // bank_id (integer)
          'u.penerimaan_nobukti', // penerimaan_nobukti (nvarchar(100))
          'u.coakasmasuk', // coakasmasuk (nvarchar(100))
          'u.relasi_id', // relasi_id (integer)
          'u.info', // info (text)
          'u.modifiedby', // modifiedby (varchar(200))
          'ap.keterangancoa as coakasmasuk_nama',
          trx.raw('r.nama as relasi_nama'), // relasi_nama (text)
          trx.raw('b.nama as bank_nama'),
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"), // created_at (datetime)
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"), // updated_at (datetime)
        ])
        .leftJoin('relasi as r', 'u.relasi_id', 'r.id')
        .leftJoin('bank as b', 'u.bank_id', 'b.id')
        .leftJoin('akunpusat as ap', 'u.coakasmasuk', 'ap.coa')
        .where('u.id', id);
      if (filters?.tglDari && filters?.tglSampai) {
        // Mengonversi tglDari dan tglSampai ke format yang diterima SQL (YYYY-MM-DD)
        const tglDariFormatted = formatDateToSQL(String(filters?.tglDari)); // Fungsi untuk format
        const tglSampaiFormatted = formatDateToSQL(String(filters?.tglSampai));

        // Menggunakan whereBetween dengan tanggal yang sudah diformat
        query.whereBetween('u.tglbukti', [
          tglDariFormatted,
          tglSampaiFormatted,
        ]);
      }
      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }
      const excludeSearchKeys = ['tglDari', 'tglSampai'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k) && filters![k],
      );
      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            qb.orWhere(`u.${field}`, 'like', `%${sanitized}%`);
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
            if (
              key === 'created_at' ||
              key === 'updated_at' ||
              key === 'editing_at'
            ) {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }

      const data = await query;

      return {
        data: data,
      };
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
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
        'pengembaliankasgantungdetail',
        'pengembaliankasgantung_id',
        trx,
      );
      if (deletedData) {
        await this.logTrailService.create(
          {
            namatabel: this.tableName,
            postingdari: 'DELETE PENGEMBALIAN KAS GANTUNG',
            idtrans: deletedData.id,
            nobuktitrans: deletedData.id,
            aksi: 'DELETE',
            datajson: JSON.stringify(deletedData),
            modifiedby: modifiedby,
          },
          trx,
        );
      }
      if (deletedDataDetail) {
        await this.logTrailService.create(
          {
            namatabel: this.tableName,
            postingdari: 'DELETE PENGEMBALIAN KAS GANTUNG DETAIL',
            idtrans: deletedDataDetail.id,
            nobuktitrans: deletedDataDetail.id,
            aksi: 'DELETE',
            datajson: JSON.stringify(deletedDataDetail),
            modifiedby: modifiedby,
          },
          trx,
        );
      }
      return { status: 200, message: 'Data deleted successfully', deletedData };
    } catch (error) {
      console.error('Error deleting data:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }
  async exportToExcel(data: any[], trx: any) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    // Header laporan
    worksheet.mergeCells('A1:E1');
    worksheet.mergeCells('A2:E2');
    worksheet.mergeCells('A3:E3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN PENGEMBALIAN KAS GANTUNG';
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
      const detailRes = await this.pengembaliankasgantungdetailService.findAll(
        {
          filters: {
            nobukti: h.nobukti,
          },
        },
        trx,
      );
      const details = detailRes.data ?? [];

      const headerInfo = [
        ['No Bukti', h.nobukti ?? ''],
        ['Tanggal Bukti', h.tglbukti ?? ''],
        ['Keterangan', h.keterangan ?? ''],
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

      if (details.length > 0) {
        const tableHeaders = ['NO.', 'NO BUKTI', 'KETERANGAN', 'NOMINAL'];
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

        details.forEach((d: any, detailIndex: number) => {
          const rowValues = [
            detailIndex + 1,
            d.nobukti ?? '',
            d.keterangan ?? '',
            d.nominal ?? '',
          ];
          rowValues.forEach((value, colIndex) => {
            const cell = worksheet.getCell(currentRow, colIndex + 1);
            cell.value = value;
            cell.font = { name: 'Tahoma', size: 10 };

            // kolom angka rata kanan, selain itu rata kiri
            if (colIndex === 3) {
              // kolom nominal
              cell.alignment = { horizontal: 'right', vertical: 'middle' };
            } else if (colIndex === 0) {
              // kolom nomor
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

        // Tambahkan total nominal
        const totalNominal = details.reduce((sum: number, d: any) => {
          return sum + (parseFloat(d.nominal) || 0);
        }, 0);

        // Row total dengan border atas tebal
        const totalRow = currentRow;
        worksheet.getCell(`A${totalRow}`).value = 'TOTAL';
        worksheet.getCell(`A${totalRow}`).font = {
          bold: true,
          name: 'Tahoma',
          size: 10,
        };
        worksheet.getCell(`A${totalRow}`).alignment = {
          horizontal: 'left',
          vertical: 'middle',
        };
        worksheet.getCell(`A${totalRow}`).border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
        // Merge baris total dari kolom A sampai C
        worksheet.mergeCells(`A${totalRow}:C${totalRow}`);

        worksheet.getCell(`D${totalRow}`).value = totalNominal;
        worksheet.getCell(`D${totalRow}`).font = {
          bold: true,
          name: 'Tahoma',
          size: 10,
        };
        worksheet.getCell(`D${totalRow}`).alignment = {
          horizontal: 'right',
          vertical: 'middle',
        };
        worksheet.getCell(`D${totalRow}`).border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };

        currentRow++;
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
      `laporan_pengembaliankasgantung${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
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
          'penerimaandetail',
          'pengembaliankasgantung_nobukti',
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
}
