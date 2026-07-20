import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CreatePengeluaranemklheaderDto } from './dto/create-pengeluaranemklheader.dto';
import { UpdatePengeluaranemklheaderDto } from './dto/update-pengeluaranemklheader.dto';
import { GlobalService } from '../global/global.service';
import { LocksService } from '../locks/locks.service';
import { Column, Workbook } from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { RunningNumberService } from '../running-number/running-number.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RedisService } from 'src/common/redis/redis.service';
import { withUuidV7, tandatanya, UtilsService  } from 'src/utils/utils.service';
import { formatDateToSQL } from 'src/utils/utils.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { PengeluaranemkldetailService } from '../pengeluaranemkldetail/pengeluaranemkldetail.service';
import { PengeluaranheaderService } from '../pengeluaranheader/pengeluaranheader.service';
import { HutangheaderService } from '../hutangheader/hutangheader.service';

@Injectable()
export class PengeluaranemklheaderService implements OnModuleInit {
  private pengeluaranheaderService: PengeluaranheaderService;

  constructor(
    // Inject wrapper RedisService (BUKAN raw 'REDIS_CLIENT'): set/get/del cache
    // jadi best-effort sehingga create/update tidak gagal 500 "Stream isn't
    // writeable" saat Redis mati. Lihat pengeluaranheader.service.ts.
    private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly pengeluaranemkldetailService: PengeluaranemkldetailService,
    private readonly moduleRef: ModuleRef,
    private readonly hutangheaderService: HutangheaderService,
  ) {}

  onModuleInit() {
    this.pengeluaranheaderService = this.moduleRef.get(PengeluaranheaderService, {
      strict: false,
    });
  }

  private readonly tableName = 'pengeluaranemklheader';
  async create(data: any, trx: any) {
    try {
      // Convert string fields to uppercase

      const pengeluaranNoBukti = data.pengeluaran_nobukti;
      const hutangNoBukti = '';
      let grp = '';
      let subgrp = '';
      let coakredit = '';
      let postingdari = '';
      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)'; // Convert TEXT/NTEXT -> text
      const insertData = {
        nobukti: data.nobukti,
        tglbukti: formatDateToSQL(data.tglbukti),
        tgljatuhtempo: formatDateToSQL(data.tgljatuhtempo),
        keterangan: data.keterangan ?? null,
        karyawan_id: data.karyawan_id ?? null,
        jenisseal_id: data.jenisseal_id ?? null,
        jenisposting: data.jenisposting,
        bank_id: data.bank_id ?? null,
        nowarkat: data.nowarkat ?? null,
        pengeluaran_nobukti:
          pengeluaranNoBukti ?? data.pengeluaran_nobukti ?? null,
        hutang_nobukti: hutangNoBukti ?? data.hutang_nobukti ?? null,
        statusformat: data.format ?? null,
        info: data.info ?? null,
        modifiedby: data.modifiedby ?? null,
        created_at: this.utilsService.getTime(),
        updated_at: this.utilsService.getTime(),
        pengeluaranemkl_id: data.pengeluaranemkl_id ?? null,
      };
      console.log(insertData, 'insertData33333');
      console.log(data, 'mentah');
      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['nobukti', 'keterangan', 'nowarkat'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      // Fetch required data for process
      if (data.coaproses) {
        const pengeluaranemklformat = await trx('pengeluaranemkl')
          .where('coaproses', data.coaproses)
          .first();

        const datacoakredit = await trx('bank as b')
          .select('b.coa')
          .where('b.id', data.bank_id)
          .first();

        const parameter = await trx('parameter')
          .select(
            'grp',
            'subgrp',
            trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
            trx.raw(`JSON_VALUE(${memoExpr}, '$.COA') AS coa_nama`),
          )
          .where('id', pengeluaranemklformat.format)
          .first();

        grp = parameter.grp;
        subgrp = parameter.subgrp;
        postingdari = parameter.memo_nama;
        coakredit = datacoakredit.coa;
        insertData.statusformat = pengeluaranemklformat.format;
        insertData.pengeluaranemkl_id = pengeluaranemklformat.id;
      }

      if (!data.coaproses) {
        if (insertData.jenisposting === 168) {
          const datacoakredit = await trx(`bank as b`)
            .select('b.coa')
            .where('b.id', insertData.bank_id)
            .first();
          const parameter = await trx('parameter')
            .select(
              'grp',
              'subgrp',
              trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
              trx.raw(`JSON_VALUE(${memoExpr}, '$.COA') AS coa_nama`),
            )
            .where('id', data.format)
            .first();
          grp = parameter.grp;
          subgrp = parameter.subgrp;
          postingdari = parameter.memo_nama;
          coakredit = datacoakredit.coa;
        } else {
          const datacoakredit = await trx(`parameter as p`)
            .select(trx.raw(`JSON_VALUE(${memoExpr}, '$.COA') AS coa_nama`))
            .where('p.grp', 'NOMOR HUTANG')
            .andWhere('p.subgrp', 'NOMOR HUTANG')
            .first();
          const parameter = await trx('parameter')
            .select(
              'grp',
              'subgrp',
              trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
              trx.raw(`JSON_VALUE(${memoExpr}, '$.COA') AS coa_nama`),
            )
            .where('id', data.format)
            .first();
          grp = parameter.grp;
          subgrp = parameter.subgrp;
          postingdari = parameter.memo_nama;
          coakredit = datacoakredit.coa_nama;
        }
      }

      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        grp,
        subgrp,
        this.tableName,
        data.tglbukti,
      );
      insertData.nobukti = nomorBukti;
      // If no coaproses, perform additional steps based on jenisposting
      if (!data.coaproses) {
        if (data.jenisposting === 168) {
          // Handle jenisposting === 168
          const requestPengeluaran = {
            tglbukti: insertData.tglbukti,
            keterangan: insertData.keterangan,
            bank_id: insertData.bank_id,
            nowarkat: insertData.nowarkat,
            tgljatuhtempo: insertData.tgljatuhtempo,
            postingdari: postingdari,
            coakredit: coakredit,
            modifiedby: insertData.modifiedby,
          };

          const pengeluaranDetails = data.details.map((detail: any) => ({
            id: 0,
            coadebet: data.coadebet ?? null,
            keterangan: detail.keterangan ?? null,
            nominal: detail.nominal ?? null,
            dpp: detail.dpp ?? 0,
            transaksibiaya_nobukti: detail.transaksibiaya_nobukti ?? null,
            transaksilain_nobukti: detail.transaksilain_nobukti ?? null,
            noinvoiceemkl: detail.noinvoiceemkl ?? null,
            tglinvoiceemkl: detail.tglinvoiceemkl ?? null,
            nofakturpajakemkl: detail.nofakturpajakemkl ?? null,
            perioderefund: detail.perioderefund ?? null,
            pengeluaranemklheader_nobukti: nomorBukti ?? null,
            penerimaanemklheader_nobukti:
              detail.penerimaanemklheader_nobukti ?? null,
            info: detail.info ?? null,
            modifiedby: insertData.modifiedby ?? null,
          }));

          const pengeluaranData = {
            ...requestPengeluaran,
            details: pengeluaranDetails,
          };
          const pengeluaranResult = await this.pengeluaranheaderService.create(
            pengeluaranData,
            trx,
          );
          insertData.pengeluaran_nobukti = pengeluaranResult?.newItem?.nobukti;
        } else {
          // Handle other jenisposting cases
          const requestHutang = {
            tglbukti: insertData.tglbukti,
            keterangan: insertData.keterangan,
            tgljatuhtempo: insertData.tgljatuhtempo,
            coa: data.coadebet,
          };

          const hutangDetails = data.details.map((detail: any) => ({
            id: 0,
            coa: coakredit ?? null,
            keterangan: detail.keterangan ?? null,
            nominal: detail.nominal ?? null,
            dpp: detail.dpp ?? 0,
            noinvoiceemkl: detail.noinvoiceemkl ?? null,
            tglinvoiceemkl: detail.tglinvoiceemkl ?? null,
            nofakturpajakemkl: detail.nofakturpajakemkl ?? null,
            info: detail.info ?? null,
            modifiedby: insertData.modifiedby ?? null,
          }));

          const hutangData = {
            ...requestHutang,
            details: hutangDetails,
          };

          const hutangResult = await this.hutangheaderService.create(
            hutangData,
            trx,
          );
          insertData.hutang_nobukti = hutangResult?.newItem?.nobukti;
        }
      }
      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

      // Handle details with nobukti
      if (data.details.length > 0) {
        const detailsWithNobukti = data.details.map((detail: any) => ({
          ...detail,
          nobukti: nomorBukti,
          pengeluaranemkl_nobukti: nomorBukti,
          modifiedby: insertData.modifiedby,
        }));

        await this.pengeluaranemkldetailService.create(
          detailsWithNobukti,
          insertedItems[0].id,
          trx,
        );
      }

      // Retrieve filtered items for pagination
      const newItem = insertedItems[0];
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
      const itemIndex = filteredItems.findIndex(
        (item) => String(item.id) === String(newItem.id),
      );
      const pageNumber = Math.floor(itemIndex / data.limit) + 1;
      const endIndex = pageNumber * data.limit;

      // Save to Redis and Log Trail
      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(filteredItems.slice(0, endIndex)),
      );
      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD PENGELUARAN EMKL HEADER`,
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby ?? null,
        },
        trx,
      );

      return { newItem, pageNumber, itemIndex };
    } catch (error) {
      console.error(error, 'Error in pengeluaran emkl header');
      throw new Error(`Error: ${error}`);
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

      // Temporary table for URL links
      const tempUrl = `temp_url_${Math.random().toString(36).substring(2, 8)}`;
      await trx.schema.createTable(tempUrl, (t) => {
        t.integer('id').nullable();
        t.string('pengeluaran_nobukti').nullable();
        t.text('link').nullable();
      });

      // Temporary table for total nominal
      const tempDetail = `temp_detail_${Math.random().toString(36).substring(2, 8)}`;
      await trx.schema.createTable(tempDetail, (t) => {
        t.integer('pengeluaranemklheader_id').nullable();
        t.string('total_nominal').nullable();
      });

      // Insert total nominal into tempDetail table
      await trx(tempDetail).insert(
        trx
          .select(
            'u.pengeluaranemklheader_id',
            trx.raw('SUM(u.nominal) as total_nominal'),
          )
          .from('pengeluaranemkldetail as u')
          .groupBy('u.pengeluaranemklheader_id'),
      );

      // Insert links into tempUrl table
      const url = 'pengeluaran';
      await trx(tempUrl).insert(
        trx
          .select(
            'u.id',
            'u.pengeluaran_nobukti',
            trx.raw(`
              STRING_AGG(
                '<a target="_blank" className="link-color" href="/dashboard/${url}' || ${tandatanya} || 'pengeluaran_nobukti=' || u.pengeluaran_nobukti || '">' ||
                '<HighlightWrapper value="' || u.pengeluaran_nobukti || '" />' ||
                '</a>', ','
              ) AS link
            `),
          )
          .from(this.tableName + ' as u')
          .groupBy('u.id', 'u.pengeluaran_nobukti'),
      );
      console.log(await trx(tempUrl), 'tempUrl');
      // Main query to select data from table and join with tempUrl and tempDetail
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          trx.raw("TO_CHAR(u.tgljatuhtempo, 'DD-MM-YYYY') as tgljatuhtempo"),
          'u.keterangan',
          'u.karyawan_id',
          'k.nama as karyawan_nama',
          'p.text as jenisposting_nama',
          'u.jenisposting',
          'u.bank_id',
          'b.nama as bank_nama',
          'u.nowarkat',
          'u.hutang_nobukti',
          'u.statusformat',
          'u.info',
          'u.modifiedby',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'u.jenisseal_id',
          'j.nama as jenisseal_text',
          'tempUrl.link',
        ])
        .leftJoin('karyawan as k', 'u.karyawan_id', 'k.id')
        .leftJoin('parameter as p', 'u.jenisposting', 'p.id')
        .leftJoin('bank as b', 'u.bank_id', 'b.id')
        .leftJoin('jenisseal as j', 'u.jenisseal_id', 'j.id')
        .innerJoin(trx.raw(`${tempUrl} as tempUrl`), 'u.id', 'tempUrl.id');

      // Apply filters
      if (filters?.ispenarikan === 'true') {
        query.andWhere('pe.statuspenarikan', 14);
      }
      if (filters?.tglDari && filters?.tglSampai) {
        const tglDariFormatted = formatDateToSQL(String(filters?.tglDari));
        const tglSampaiFormatted = formatDateToSQL(String(filters?.tglSampai));
        query.whereBetween('u.tglbukti', [
          tglDariFormatted,
          tglSampaiFormatted,
        ]);
      }

      // Apply search
      const excludeSearchKeys = ['tglDari', 'tglSampai', 'ispenarikan'];
      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k) && filters![k],
      );
      if (search) {
        const sanitized = String(search).replace(/\$/g, '[[]').trim();
        query.where((qb) => {
          searchFields.forEach((field) => {
            qb.orWhere(`u.${field}`, 'like', `%${sanitized}%`);
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\$/g, '[[]');
          if (key === 'tglDari' || key === 'tglSampai' || key === 'ispenarikan')
            continue;

          if (value) {
            if (
              key === 'created_at' ||
              key === 'updated_at' ||
              key === 'tglbukti' ||
              key === 'tgljatuhtempo'
            ) {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'karyawan_nama') {
              query.andWhere('k.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'bank_nama') {
              query.andWhere('b.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'jenisseal_text') {
              query.andWhere('j.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'jenisseal_id') {
              query.andWhere('u.jenisseal_id', 'like', `%${sanitizedValue}%`);
            } else if (key === 'relasi_id') {
              query.andWhere('ph.relasi_id', 'like', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }

      // Get total count
      const result = await trx(this.tableName).count('id as total').first();
      const total = result?.total as number;
      const totalPages = Math.ceil(total / limit);

      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }

      const data = await query;

      const responseType = Number(total) > 500 ? 'json' : 'local';

      return {
        data,
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
  async findOne(id: string, trx: any) {
    try {
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.nobukti', // nobukti (nvarchar(100))
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          trx.raw("TO_CHAR(u.tgljatuhtempo, 'DD-MM-YYYY') as tgljatuhtempo"),
          'u.keterangan', // keterangan (text)
          'u.karyawan_id', // keterangan (text)
          'k.nama as karyawan_nama',
          'p.text as jenisposting_nama',
          'u.jenisposting', // keterangan (text)
          'u.bank_id', // keterangan (text)
          'b.nama as bank_nama',
          'u.nowarkat', // keterangan (text)
          'u.pengeluaran_nobukti', // keterangan (text)
          'u.hutang_nobukti', // keterangan (text)
          'pe.nama as statusformat_nama',
          'u.statusformat', // bank_id (integer)
          'u.info', // info (text)
          'u.modifiedby', // modifiedby (varchar(200))
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"), // created_at (datetime)
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"), // updated_at (datetime)
        ])
        .leftJoin('karyawan as k', 'u.karyawan_id', 'k.id')
        .leftJoin('parameter as p', 'u.jenisposting', 'p.id')
        .leftJoin('bank as b', 'u.bank_id', 'b.id')
        .leftJoin('pengeluaranemkl as pe', 'u.statusformat', 'pe.format')
        .where('u.id', id);

      const data = await query;

      return {
        data: data,
      };
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async update(id: any, data: any, trx: any) {
    try {
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        pengembaliankasgantung_nobukti,
        relasi_nama,
        jenisposting_nama,
        pengeluaran_nobukti,
        format,
        statusformat_nama,
        coadebet,
        alatbayar_nama,
        penerimaan_nobukti,
        bank_nama,
        karyawan_nama,
        jenisseal_text,
        details,
        ...insertData
      } = data;

      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['nobukti', 'keterangan', 'nowarkat'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      insertData.tglbukti = formatDateToSQL(String(insertData?.tglbukti)); // Fungsi untuk format
      insertData.tgljatuhtempo = formatDateToSQL(
        String(insertData?.tgljatuhtempo),
      ); // Fungsi untuk format
      const existingData = await trx(this.tableName).where('id', id).first();

      const pengeluaranNoBukti = '';
      const hutangNoBukti = '';
      let grp = '';
      let subgrp = '';
      let coakredit = '';
      let postingdari = '';
      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)'; // penting: TEXT/NTEXT -> text
      if (insertData.jenisposting === 168) {
        const datacoakredit = await trx(`bank as b`)
          .select('b.coa')
          .where('b.id', insertData.bank_id)
          .first();
        const parameter = await trx('parameter')
          .select(
            'grp',
            'subgrp',
            trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
            trx.raw(`JSON_VALUE(${memoExpr}, '$.COA') AS coa_nama`),
          )
          .where('id', format)
          .first();
        grp = parameter.grp;
        subgrp = parameter.subgrp;
        postingdari = parameter.memo_nama;
        coakredit = datacoakredit.coa;
      } else {
        const datacoakredit = await trx(`parameter as p`)
          .select(trx.raw(`JSON_VALUE(${memoExpr}, '$.COA') AS coa_nama`))
          .where('p.grp', 'NOMOR HUTANG')
          .andWhere('p.subgrp', 'NOMOR HUTANG')
          .first();
        const parameter = await trx('parameter')
          .select(
            'grp',
            'subgrp',
            trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
            trx.raw(`JSON_VALUE(${memoExpr}, '$.COA') AS coa_nama`),
          )
          .where('id', format)
          .first();
        grp = parameter.grp;
        subgrp = parameter.subgrp;
        postingdari = parameter.memo_nama;
        coakredit = datacoakredit.coa_nama;
      }

      if (insertData.jenisposting === 168) {
        const existingPengeluaran = await trx('pengeluaranheader')
          .where('nobukti', existingData.pengeluaran_nobukti)
          .first();
        const requestPengeluaran = {
          tglbukti: insertData.tglbukti,
          keterangan: insertData.keterangan,
          bank_id: insertData.bank_id,
          nowarkat: insertData.nowarkat,
          tgljatuhtempo: insertData.tgljatuhtempo,
          postingdari: postingdari,
          coakredit: existingPengeluaran.coakredit,
        };

        const pengeluaranDetails = details.map((detail: any) => ({
          id: 0,
          coadebet: coadebet ?? null,
          keterangan: detail.keterangan ?? null,
          nominal: detail.nominal ?? null,
          dpp: detail.dpp ?? 0,
          transaksibiaya_nobukti: detail.transaksibiaya_nobukti ?? null,
          transaksilain_nobukti: detail.transaksilain_nobukti ?? null,
          noinvoiceemkl: detail.noinvoiceemkl ?? null,
          tglinvoiceemkl: detail.tglinvoiceemkl ?? null,
          nofakturpajakemkl: detail.nofakturpajakemkl ?? null,
          perioderefund: detail.perioderefund ?? null,
          pengeluaranemklheader_nobukti: insertData.nobukti ?? null,
          penerimaanemklheader_nobukti:
            detail.penerimaanemklheader_nobukti ?? null,
          info: detail.info ?? null,
          modifiedby: insertData.modifiedby ?? null,
        }));

        const pengeluaranData = {
          ...requestPengeluaran,
          details: pengeluaranDetails,
        };
        const pengeluaranResult = await this.pengeluaranheaderService.update(
          existingPengeluaran.id,
          pengeluaranData,
          trx,
        );
      } else {
        const existingHutang = await trx('hutangheader')
          .where('nobukti', existingData.hutang_nobukti)
          .first();
        const requestHutang = {
          tglbukti: insertData.tglbukti,
          keterangan: insertData.keterangan,
          tgljatuhtempo: insertData.tgljatuhtempo,
          coa: coadebet,
        };

        const hutangDetails = details.map((detail: any) => ({
          id: 0,
          coa: coakredit ?? null,
          keterangan: detail.keterangan ?? null,
          nominal: detail.nominal ?? null,
          dpp: detail.dpp ?? 0,
          noinvoiceemkl: detail.noinvoiceemkl ?? null,
          tglinvoiceemkl: detail.tglinvoiceemkl ?? null,
          nofakturpajakemkl: detail.nofakturpajakemkl ?? null,
          info: detail.info ?? null,
          modifiedby: insertData.modifiedby ?? null,
        }));

        const hutangData = {
          ...requestHutang,
          details: hutangDetails,
        };
        const hutangResult = await this.hutangheaderService.update(
          existingHutang.id,
          hutangData,
          trx,
        );
      }

      const hasChanges = this.utilsService.hasChanges(insertData, existingData);

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();

        await trx(this.tableName).where('id', id).update(insertData);
      }

      if (details.length > 0) {
        const detailsWithNobukti = details.map((detail: any) => ({
          ...detail,
          nobukti: insertData.nobukti, // Inject nobukti into each detail
          pengeluaranemkl_nobukti: insertData.nobukti,
          modifiedby: insertData.modifiedby,
        }));

        // Pass the updated details with nobukti to the detail creation service
        await this.pengeluaranemkldetailService.create(
          detailsWithNobukti,
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
          isLookUp: false, // Set based on your requirement (e.g., lookup flag)
        },
        trx,
      );

      // Cari index item baru di hasil yang sudah difilter
      let itemIndex = filteredItems.findIndex(
        (item) => String(item.id) === String(id),
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
          postingdari: `ADD PENGELUARAN EMKL HEADER`,
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
        itemIndex,
      };
    } catch (error) {
      console.log(error);
      throw new Error(`Error: ${error}`);
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
        'pengeluaranemkldetail',
        'jurnalumum_id',
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE PENGELUARAN EMKL DETAIL',
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
  async exportToExcel(data: any[], trx: any) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    // Header laporan
    worksheet.mergeCells('A1:D1');
    worksheet.mergeCells('A2:D2');
    worksheet.mergeCells('A3:D3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN PENGELUARAN EMKL';
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
      const detailRes = await this.pengeluaranemkldetailService.findAll(
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
      `laporan_pengeluaran_emkl${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
  async getPengeluaranEmkl(dari: any, sampai: any, trx: any) {
    try {
      const tglDariFormatted = formatDateToSQL(dari);
      const tglSampaiFormatted = formatDateToSQL(sampai);
      const temp = 'temp_' + Math.random().toString(36).substring(2, 8);

      // Membuat tabel sementara
      await trx.schema.createTable(temp, (t) => {
        t.string('nobukti');
        t.date('tglbukti');
        t.bigInteger('sisa').nullable();
        t.bigInteger('sudah_dibayar').nullable(); // Tambahkan field sudah dibayar
        t.bigInteger('jumlahpinjaman').nullable(); // Tambahkan field totalpinjaman
        t.text('keterangan').nullable();
      });

      // Menyisipkan data ke dalam tabel sementara
      await trx(temp).insert(
        trx
          .select(
            'ped.nobukti',
            trx.raw('CAST(pgh.tglbukti AS DATE) AS tglbukti'),
            trx.raw(`
              (SELECT (sum(ped.nominal) - COALESCE(SUM(pd.nominal), 0)) 
               FROM penerimaanemkldetail as pd 
               WHERE pd.pengeluaranemkl_nobukti = ped.nobukti) AS sisa, 
              (SELECT COALESCE(SUM(pd.nominal), 0) 
               FROM penerimaanemkldetail AS pd 
               WHERE pd.pengeluaranemkl_nobukti = ped.nobukti) AS sudah_dibayar, -- Subquery untuk total pembayaran
              (SELECT COALESCE(SUM(ped.nominal), 0) 
               FROM pengeluaranemkldetail AS ped 
               WHERE ped.nobukti = pgh.nobukti) AS jumlahpinjaman, -- Subquery untuk jumlah pinjaman
              MAX(ped.keterangan)
            `),
          )
          .from('pengeluaranemkldetail as ped')
          .leftJoin(
            'pengeluaranemklheader as pgh',
            'pgh.id',
            'ped.pengeluaranemklheader_id',
          )
          .where('pgh.pengeluaranemkl_id', 1)
          .whereBetween('pgh.tglbukti', [tglDariFormatted, tglSampaiFormatted])
          .groupBy('ped.nobukti', 'pgh.tglbukti', 'pgh.nobukti')
          .orderBy('pgh.tglbukti', 'asc')
          .orderBy('ped.nobukti', 'asc'),
      );

      // Mengambil data dari tabel sementara
      const result = trx
        .select(
          trx.raw(`row_number() OVER (ORDER BY ??) as id`, [`${temp}.nobukti`]),
          trx.raw(`TO_CHAR(${temp}.tglbukti, 'DD-MM-YYYY') as tglbukti`),
          `${temp}.nobukti`,
          `${temp}.sisa`,
          `${temp}.sudah_dibayar`, // Menambahkan field sudah dibayar
          `${temp}.jumlahpinjaman`, // Menambahkan field total pinjaman
          `${temp}.keterangan as keterangan`,
        )
        .from(`${temp}`)
        .where(function () {
          this.whereRaw(`${temp}.sisa != 0`).orWhereRaw(`${temp}.sisa is null`);
        });

      return result;
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async getPengembalianPinjaman(id: any, dari: any, sampai: any, trx: any) {
    try {
      // Sumber data
      const tempPribadi = await this.createTempPengembalianPinjaman(
        id,
        dari,
        sampai,
        trx,
      );
      const tempAll = await this.createTempPengembalian(id, dari, sampai, trx);

      // Temp final
      const temp = 'tempGet' + Math.random().toString(36).substring(2, 8);

      await trx.schema.createTable(temp, (t) => {
        t.bigInteger('penerimaanemklheader_id').nullable();
        t.string('nobukti');
        t.date('tglbukti').nullable();
        t.string('keterangan').nullable();
        t.bigInteger('sisa').nullable();
        t.bigInteger('bayar').nullable();
        // kolom baru:
        t.bigInteger('sudah_dibayar').nullable();
        t.bigInteger('jumlahpinjaman').nullable();
      });

      // Baris yang terkait dengan penerimaan (ada bayar)
      const pengembalian = trx(`${tempPribadi} as tp`).select(
        'tp.penerimaanemklheader_id',
        'tp.nobukti',
        'tp.tglbukti',
        'tp.keterangan',
        'tp.sisa',
        'tp.bayar',
        // kolom baru dihitung seperti di getPengeluaranEmkl:
        trx.raw(`(
          SELECT COALESCE(SUM(pgd2.nominal), 0)
          FROM penerimaanemkldetail pgd2
          WHERE pgd2.pengeluaranemkl_nobukti = tp.nobukti
        ) AS sudah_dibayar`),
        trx.raw(`(
          SELECT COALESCE(SUM(kd2.nominal), 0)
          FROM pengeluaranemkldetail kd2
          WHERE kd2.nobukti = tp.nobukti
        ) AS jumlahpinjaman`),
      );

      await trx(temp).insert(pengembalian);

      // Baris pinjaman lain (belum dibayar oleh penerimaan ini) -> bayar = 0
      const pinjaman = trx(`${tempAll} as ta`)
        .select(
          trx.raw('NULL as penerimaanemklheader_id'),
          'ta.nobukti',
          'ta.tglbukti',
          'ta.keterangan',
          'ta.sisa',
          trx.raw('0 as bayar'),
          // kolom baru:
          trx.raw(`(
            SELECT COALESCE(SUM(pgd2.nominal), 0)
            FROM penerimaanemkldetail pgd2
            WHERE pgd2.pengeluaranemkl_nobukti = ta.nobukti
          ) AS sudah_dibayar`),
          trx.raw(`(
            SELECT COALESCE(SUM(kd2.nominal), 0)
            FROM pengeluaranemkldetail kd2
            WHERE kd2.nobukti = ta.nobukti
          ) AS jumlahpinjaman`),
        )
        .where(function () {
          this.whereRaw(`ta.sisa != 0`).orWhereRaw(`ta.sisa is null`);
        });

      await trx(temp).insert(pinjaman);

      // Hasil akhir
      const data = await trx
        .select(
          trx.raw(`row_number() OVER (ORDER BY ??) as id`, [`${temp}.nobukti`]),
          `${temp}.penerimaanemklheader_id`,
          `${temp}.nobukti`,
          trx.raw(`TO_CHAR(${temp}.tglbukti, 'DD-MM-YYYY') as tglbukti`),
          `${temp}.keterangan as keterangan`,
          `${temp}.sisa`,
          `${temp}.bayar as nominal`,
          // expose kolom baru:
          `${temp}.sudah_dibayar`,
          `${temp}.jumlahpinjaman`,
        )
        .from(`${temp}`)
        .where(function () {
          this.whereRaw(`${temp}.sisa != 0`).orWhereRaw(`${temp}.sisa is null`);
        });

      return data;
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async createTempPengembalian(id: any, dari: any, sampai: any, trx: any) {
    try {
      const tglDariFormatted = formatDateToSQL(dari);
      const tglSampaiFormatted = formatDateToSQL(sampai);
      const temp = 'temp_' + Math.random().toString(36).substring(2, 8);

      // Create temp table for 'pengembalian'
      await trx.schema.createTable(temp, (t) => {
        t.string('nobukti');
        t.date('tglbukti');
        t.bigInteger('sisa').nullable();
        t.text('keterangan').nullable();
      });

      // Insert data into temp table for 'pengembalian'
      await trx(temp).insert(
        trx
          .select(
            'kd.nobukti',
            trx.raw('CAST(kg.tglbukti AS DATE) AS tglbukti'),
            trx.raw(`
              (SELECT (sum(kd.nominal) - COALESCE(SUM(pgd.nominal), 0)) 
               FROM penerimaanemkldetail as pgd 
               WHERE pgd.pengeluaranemkl_nobukti = kd.nobukti) AS sisa, 
              MAX(kd.keterangan)
            `),
          )
          .from('pengeluaranemkldetail as kd')
          .leftJoin('pengeluaranemklheader as kg', 'kg.nobukti', 'kd.nobukti')
          .whereRaw(
            'kg.nobukti not in (select pengeluaranemkl_nobukti from penerimaanemkldetail where penerimaanemklheader_id=?)',
            [id],
          )
          .where('kg.pengeluaranemkl_id', 1)
          .whereBetween('kg.tglbukti', [tglDariFormatted, tglSampaiFormatted])
          .groupBy('kd.nobukti', 'kg.tglbukti'),
      );
      return temp;
    } catch (error) {
      console.error('Error creating tempPengembalianKasGantung:', error);
      throw new Error('Failed to create tempPengembalianKasGantung');
    }
  }
  async createTempPengembalianPinjaman(
    id: any,
    dari: any,
    sampai: any,
    trx: any,
  ) {
    try {
      const tglDariFormatted = formatDateToSQL(dari);
      const tglSampaiFormatted = formatDateToSQL(sampai);
      const temp = 'temp_' + Math.random().toString(36).substring(2, 8);

      // Create temp table for 'pengembalian2'
      await trx.schema.createTable(temp, (t) => {
        t.bigInteger('penerimaanemklheader_id').nullable();
        t.string('nobukti');
        t.date('tglbukti');
        t.bigInteger('bayar').nullable();
        t.string('keterangan').nullable();
        t.bigInteger('sisa').nullable();
      });

      // Insert data into temp table for 'pengembalian2'
      await trx(temp).insert(
        trx
          .select(
            'pgd.penerimaanemklheader_id as penerimaanemklheader_id',
            'kd.nobukti',
            trx.raw('CAST(kg.tglbukti AS DATE) AS tglbukti'),
            trx.raw(`
              pgd.nominal as bayar,
              pgd.keterangan as keterangan,
              (SELECT (sum(kd.nominal) - COALESCE(SUM(pgd.nominal), 0)) 
               FROM penerimaanemkldetail as pgd 
               WHERE pgd.pengeluaranemkl_nobukti = kd.nobukti) AS sisa
            `),
          )
          .from('pengeluaranemkldetail as kd')
          .leftJoin(
            'pengeluaranemklheader as kg',
            'kg.id',
            'kd.pengeluaranemklheader_id',
          )
          .leftJoin(
            'penerimaanemkldetail as pgd',
            'pgd.pengeluaranemkl_nobukti',
            'kd.nobukti',
          )
          .leftJoin(
            'penerimaanemklheader as pgh',
            'pgh.id',
            'pgd.penerimaanemklheader_id',
          )
          .where('kg.pengeluaranemkl_id', 1)
          .whereBetween('kg.tglbukti', [tglDariFormatted, tglSampaiFormatted])
          .where('pgd.penerimaanemklheader_id', id)
          .groupBy(
            'pgd.penerimaanemklheader_id',
            'kd.nobukti',
            'kg.tglbukti',
            'pgd.nominal',
            'pgd.keterangan',
          ),
      );

      return temp;
    } catch (error) {
      console.error('Error creating tempPengembalian:', error);
      throw new Error('Failed to create tempPengembalian');
    }
  }

  async getPengeluaran(dari: any, sampai: any, trx: any) {
    try {
      const tglDariFormatted = formatDateToSQL(dari);
      const tglSampaiFormatted = formatDateToSQL(sampai);
      // Nama tabel tanpa prefix '##' (itu sintaks global temp table SQL Server).
      // Di PostgreSQL '#' bukan karakter identifier valid: knex meng-quote di
      // FROM ("##temp_x") tapi whereRaw/raw memakainya tanpa quote (##temp_x.sisa)
      // → PG salah-parse → "missing FROM-clause entry for table temp_x" → 500.
      const temp = 'temp_' + Math.random().toString(36).substring(2, 8);

      // Membuat tabel sementara
      await trx.schema.createTable(temp, (t) => {
        t.string('nobukti');
        t.date('tglbukti');
        t.bigInteger('sisa').nullable();
        t.bigInteger('sudah_dibayar').nullable();
        t.bigInteger('jumlahpinjaman').nullable();
        t.text('keterangan').nullable();
        t.string('transaksilain_nobukti').nullable();
        t.string('transaksibiaya_nobukti').nullable();
        t.bigInteger('dpp').nullable();
        t.string('coadebet').nullable();
        t.string('coadebet_text').nullable();
      });

      // Menyisipkan data ke dalam tabel sementara
      await trx(temp).insert(
        trx
          .select(
            'ped.nobukti',
            trx.raw('CAST(pgh.tglbukti AS DATE) AS tglbukti'),
            trx.raw(`
              CASE 
                WHEN pe.nilaiprosespenerimaan = (SELECT id FROM parameter WHERE grp = 'NILAI PROSES' AND text = 'NEGATIF' LIMIT 1) THEN
                  -1 * (
                    COALESCE(
                      (SELECT SUM(ped_inner.nominal) FROM pengeluaranemkldetail AS ped_inner WHERE ped_inner.nobukti = ped.nobukti),
                      0
                    ) - 
                    COALESCE(
                      (SELECT SUM(pd.nominal) FROM penerimaanemkldetail AS pd WHERE pd.pengeluaranemkl_nobukti = ped.nobukti),
                      0
                    )
                  )
                ELSE
                  COALESCE(
                    (SELECT SUM(ped_inner.nominal) FROM pengeluaranemkldetail AS ped_inner WHERE ped_inner.nobukti = ped.nobukti),
                    0
                  ) - 
                  COALESCE(
                    (SELECT SUM(pd.nominal) FROM penerimaanemkldetail AS pd WHERE pd.pengeluaranemkl_nobukti = ped.nobukti),
                    0
                  )
              END AS sisa
            `),
            trx.raw(`
              CASE 
                WHEN pe.nilaiprosespenerimaan = (SELECT id FROM parameter WHERE grp = 'NILAI PROSES' AND text = 'NEGATIF' LIMIT 1) THEN
                  -1 * COALESCE(
                    (SELECT SUM(pd.nominal) FROM penerimaanemkldetail AS pd WHERE pd.pengeluaranemkl_nobukti = ped.nobukti),
                    0
                  )
                ELSE
                  COALESCE(
                    (SELECT SUM(pd.nominal) FROM penerimaanemkldetail AS pd WHERE pd.pengeluaranemkl_nobukti = ped.nobukti),
                    0
                  )
              END AS sudah_dibayar
            `),
            trx.raw(`
              CASE 
                WHEN pe.nilaiprosespenerimaan = (SELECT id FROM parameter WHERE grp = 'NILAI PROSES' AND text = 'NEGATIF' LIMIT 1) THEN
                  -1 * COALESCE(
                    (SELECT SUM(ped_inner.nominal) FROM pengeluaranemkldetail AS ped_inner WHERE ped_inner.nobukti = pgh.nobukti),
                    0
                  )
                ELSE
                  COALESCE(
                    (SELECT SUM(ped_inner.nominal) FROM pengeluaranemkldetail AS ped_inner WHERE ped_inner.nobukti = pgh.nobukti),
                    0
                  )
              END AS jumlahpinjaman
            `),
            trx.raw('MAX(ped.keterangan) AS keterangan'),
            'pged.transaksilain_nobukti as transaksilain_nobukti',
            'pged.transaksibiaya_nobukti as transaksibiaya_nobukti',
            'pged.dpp as dpp',
            'pged.coadebet as coadebet',
            'ap.keterangancoa as coadebet_text',
          )
          .from('pengeluaranemkldetail as ped')
          .leftJoin(
            'pengeluaranemklheader as pgh',
            'pgh.id',
            'ped.pengeluaranemklheader_id',
          )
          .leftJoin('pengeluaranemkl as pe', 'pe.id', 'pgh.pengeluaranemkl_id')
          .leftJoin(
            'pengeluarandetail as pged',
            'pgh.pengeluaran_nobukti',
            'pged.nobukti',
          )
          .leftJoin('akunpusat as ap', 'ap.coa', 'pged.coadebet')
          .whereBetween('pgh.tglbukti', [tglDariFormatted, tglSampaiFormatted])
          .groupBy(
            'ped.nobukti',
            'pgh.tglbukti',
            'pgh.nobukti',
            'pged.nobukti',
            'pged.transaksilain_nobukti',
            'pged.transaksibiaya_nobukti',
            'pged.dpp',
            'pged.coadebet',
            'ap.keterangancoa',
            'pe.nilaiprosespenerimaan', // Tambahkan ke GROUP BY
          )
          .orderBy('pgh.tglbukti', 'asc')
          .orderBy('ped.nobukti', 'asc'),
      );

      // Mengambil data dari tabel sementara
      const rows = await trx
        .select(
          trx.raw(`row_number() OVER (ORDER BY ??) as id`, [`${temp}.nobukti`]),
          trx.raw(`TO_CHAR(${temp}.tglbukti, 'DD-MM-YYYY') as tglbukti`),
          `${temp}.nobukti`,
          `${temp}.sisa`,
          `${temp}.sudah_dibayar`,
          `${temp}.jumlahpinjaman`,
          `${temp}.keterangan as keterangan`,
          `${temp}.transaksilain_nobukti as transaksilain_nobukti`,
          `${temp}.transaksibiaya_nobukti as transaksibiaya_nobukti`,
          `${temp}.coadebet_text as coadebet_text`,
          `${temp}.dpp as dpp`,
          `${temp}.coadebet as coadebet`,
        )
        .from(`${temp}`)
        .where(function () {
          this.whereRaw(`${temp}.sisa != 0`).orWhereRaw(`${temp}.sisa is null`);
        });

      // Drop temp table di dalam transaksi agar tidak bocor sebagai tabel
      // permanen tiap request (schema.createTable di PG membuat tabel biasa,
      // bukan TEMP). Hasil sudah di-await di atas jadi aman untuk di-drop.
      await trx.schema.dropTableIfExists(temp);

      return rows;
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async getPengembalianHutangLain(id: any, dari: any, sampai: any, trx: any) {
    try {
      // Sumber data
      const tempPribadi = await this.createTempHutangLain(
        id,
        dari,
        sampai,
        trx,
      );
      const tempAll = await this.createTempPengembalianHutangLain(
        id,
        dari,
        sampai,
        trx,
      );

      // Temp final
      const temp = 'tempGet' + Math.random().toString(36).substring(2, 8);

      await trx.schema.createTable(temp, (t) => {
        t.bigInteger('penerimaanemklheader_id').nullable();
        t.string('nobukti');
        t.date('tglbukti').nullable();
        t.string('keterangan').nullable();
        t.bigInteger('sisa').nullable();
        t.bigInteger('bayar').nullable();
        // kolom baru:
        t.bigInteger('sudah_dibayar').nullable();
        t.bigInteger('jumlahpinjaman').nullable();
      });

      // Baris yang terkait dengan penerimaan (ada bayar)
      const pengembalian = trx(`${tempPribadi} as tp`).select(
        'tp.penerimaanemklheader_id',
        'tp.nobukti',
        'tp.tglbukti',
        'tp.keterangan',
        'tp.sisa',
        'tp.bayar',
        // kolom baru dihitung seperti di getPengeluaranEmkl:
        trx.raw(`(
          SELECT COALESCE(SUM(pgd2.nominal), 0)
          FROM penerimaanemkldetail pgd2
          WHERE pgd2.pengeluaranemkl_nobukti = tp.nobukti
        ) AS sudah_dibayar`),
        trx.raw(`(
          SELECT COALESCE(SUM(kd2.nominal), 0)
          FROM pengeluaranemkldetail kd2
          WHERE kd2.nobukti = tp.nobukti
        ) AS jumlahpinjaman`),
      );

      await trx(temp).insert(pengembalian);

      // Baris pinjaman lain (belum dibayar oleh penerimaan ini) -> bayar = 0
      const pinjaman = trx(`${tempAll} as ta`)
        .select(
          trx.raw('NULL as penerimaanemklheader_id'),
          'ta.nobukti',
          'ta.tglbukti',
          'ta.keterangan',
          'ta.sisa',
          trx.raw('0 as bayar'),
          // kolom baru:
          trx.raw(`(
            SELECT COALESCE(SUM(pgd2.nominal), 0)
            FROM penerimaanemkldetail pgd2
            WHERE pgd2.pengeluaranemkl_nobukti = ta.nobukti
          ) AS sudah_dibayar`),
          trx.raw(`(
            SELECT COALESCE(SUM(kd2.nominal), 0)
            FROM pengeluaranemkldetail kd2
            WHERE kd2.nobukti = ta.nobukti
          ) AS jumlahpinjaman`),
        )
        .where(function () {
          this.whereRaw(`ta.sisa != 0`).orWhereRaw(`ta.sisa is null`);
        });

      await trx(temp).insert(pinjaman);

      // Hasil akhir
      const data = await trx
        .select(
          trx.raw(`row_number() OVER (ORDER BY ??) as id`, [`${temp}.nobukti`]),
          `${temp}.penerimaanemklheader_id`,
          `${temp}.nobukti`,
          trx.raw(`TO_CHAR(${temp}.tglbukti, 'DD-MM-YYYY') as tglbukti`),
          `${temp}.keterangan as keterangan`,
          `${temp}.sisa`,
          `${temp}.bayar as nominal`,
          // expose kolom baru:
          `${temp}.sudah_dibayar`,
          `${temp}.jumlahpinjaman`,
        )
        .from(`${temp}`)
        .where(function () {
          this.whereRaw(`${temp}.sisa != 0`).orWhereRaw(`${temp}.sisa is null`);
        });

      return data;
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async createTempPengembalianHutangLain(
    id: any,
    dari: any,
    sampai: any,
    trx: any,
  ) {
    try {
      const tglDariFormatted = formatDateToSQL(dari);
      const tglSampaiFormatted = formatDateToSQL(sampai);
      const temp = 'temp_' + Math.random().toString(36).substring(2, 8);

      // Create temp table for 'pengembalian'
      await trx.schema.createTable(temp, (t) => {
        t.string('nobukti');
        t.date('tglbukti');
        t.bigInteger('sisa').nullable();
        t.text('keterangan').nullable();
      });

      // Insert data into temp table for 'pengembalian'
      await trx(temp).insert(
        trx
          .select(
            'kd.nobukti',
            trx.raw('CAST(kg.tglbukti AS DATE) AS tglbukti'),
            trx.raw(`
              (SELECT (sum(kd.nominal) - COALESCE(SUM(pgd.nominal), 0)) 
               FROM penerimaanemkldetail as pgd 
               WHERE pgd.pengeluaranemkl_nobukti = kd.nobukti) AS sisa, 
              MAX(kd.keterangan)
            `),
          )
          .from('pengeluaranemkldetail as kd')
          .leftJoin('pengeluaranemklheader as kg', 'kg.nobukti', 'kd.nobukti')
          .whereRaw(
            'kg.nobukti not in (select pengeluaranemkl_nobukti from penerimaanemkldetail where penerimaanemklheader_id=?)',
            [id],
          )
          .where('kg.pengeluaranemkl_id', 2)
          .whereBetween('kg.tglbukti', [tglDariFormatted, tglSampaiFormatted])
          .groupBy('kd.nobukti', 'kg.tglbukti'),
      );
      return temp;
    } catch (error) {
      console.error('Error creating tempPengembalianKasGantung:', error);
      throw new Error('Failed to create tempPengembalianKasGantung');
    }
  }
  async createTempHutangLain(id: any, dari: any, sampai: any, trx: any) {
    try {
      const tglDariFormatted = formatDateToSQL(dari);
      const tglSampaiFormatted = formatDateToSQL(sampai);
      const temp = 'temp_' + Math.random().toString(36).substring(2, 8);

      // Create temp table for 'pengembalian2'
      await trx.schema.createTable(temp, (t) => {
        t.bigInteger('penerimaanemklheader_id').nullable();
        t.string('nobukti');
        t.date('tglbukti');
        t.bigInteger('bayar').nullable();
        t.string('keterangan').nullable();
        t.bigInteger('sisa').nullable();
      });
      await trx(temp).insert(
        trx
          .select(
            'pgd.penerimaanemklheader_id as penerimaanemklheader_id',
            'kd.nobukti',
            trx.raw('CAST(kg.tglbukti AS DATE) AS tglbukti'),
            trx.raw(`
              pgd.nominal as bayar,
              pgd.keterangan as keterangan,
              (SELECT (sum(kd.nominal) - COALESCE(SUM(pgd.nominal), 0)) 
               FROM penerimaanemkldetail as pgd 
               WHERE pgd.pengeluaranemkl_nobukti = kd.nobukti) AS sisa
            `),
          )
          .from('pengeluaranemkldetail as kd')
          .leftJoin(
            'pengeluaranemklheader as kg',
            'kg.id',
            'kd.pengeluaranemklheader_id',
          )
          .leftJoin(
            'penerimaanemkldetail as pgd',
            'pgd.pengeluaranemkl_nobukti',
            'kd.nobukti',
          )
          .leftJoin(
            'penerimaanemklheader as pgh',
            'pgh.id',
            'pgd.penerimaanemklheader_id',
          )
          .where('kg.pengeluaranemkl_id', 2)
          .whereBetween('kg.tglbukti', [tglDariFormatted, tglSampaiFormatted])
          .where('pgd.penerimaanemklheader_id', id)
          .groupBy(
            'pgd.penerimaanemklheader_id',
            'kd.nobukti',
            'kg.tglbukti',
            'pgd.nominal',
            'pgd.keterangan',
          ),
      );

      return temp;
    } catch (error) {
      console.error('Error creating tempPengembalian:', error);
      throw new Error('Failed to create tempPengembalian');
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
          'pengembalianjurnalumumdetail',
          'jurnalumum_nobukti',
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
