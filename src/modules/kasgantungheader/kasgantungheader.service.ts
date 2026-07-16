import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateKasgantungheaderDto } from './dto/create-kasgantungheader.dto';
import { UpdateKasgantungheaderDto } from './dto/update-kasgantungheader.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { RedisService } from 'src/common/redis/redis.service';
import {
  withUuidV7,
  formatDateToSQL,
  UtilsService,
  tandatanya,
 } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { PengembaliankasgantungdetailService } from '../pengembaliankasgantungdetail/pengembaliankasgantungdetail.service';
import { KasgantungdetailService } from '../kasgantungdetail/kasgantungdetail.service';
import { GlobalService } from '../global/global.service';
import { PengeluaranheaderService } from '../pengeluaranheader/pengeluaranheader.service';
import { LocksService } from '../locks/locks.service';
import { Column, Workbook } from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { StatuspendukungService } from '../statuspendukung/statuspendukung.service';

@Injectable()
export class KasgantungheaderService {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly kasgantungdetailService: KasgantungdetailService,
    private readonly pengeluaranheaderService: PengeluaranheaderService,
    private readonly statuspendukungService: StatuspendukungService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
  ) {}
  private readonly tableName = 'kasgantungheader';
  async create(data: any, trx: any) {
    try {
      console.log('[KASGANTUNG] Starting create process...');
      const startTime = Date.now();

      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        relasi_nama,
        alatbayar_nama,
        bank_nama,
        details,
        ...insertData
      } = data;
      insertData.updated_at = this.utilsService.getTime();
      insertData.created_at = this.utilsService.getTime();
      Object.keys(insertData).forEach((key) => {
        if (typeof insertData[key] === 'string') {
          insertData[key] = insertData[key].toUpperCase();
        }
      });
      insertData.tglbukti = formatDateToSQL(String(insertData?.tglbukti));

      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)'; // penting: TEXT/NTEXT -> text

      const parameterCabang = await trx('parameter')
        .select(trx.raw(`JSON_VALUE(${memoExpr}, '$.CABANG_ID') AS cabang_id`))
        .where('grp', 'CABANG')
        .andWhere('subgrp', 'CABANG')
        .first();

      const formatpengeluarangantung = await trx(`bank as b`)
        .select('p.grp', 'p.subgrp', 'b.formatpengeluarangantung')
        .leftJoin('parameter as p', 'p.id', 'b.formatpengeluarangantung')
        .where('b.id', insertData.bank_id)
        .first();

      const parameter = await trx('parameter')
        .select(
          'grp',
          'subgrp',
          trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
          trx.raw(`JSON_VALUE(${memoExpr}, '$.COA') AS coa_nama`),
        )
        .where('id', formatpengeluarangantung.formatpengeluarangantung)
        .first();

      const grp = formatpengeluarangantung.grp;
      const subgrp = formatpengeluarangantung.subgrp;
      const cabangId = parameterCabang.cabang_id;

      if (!grp || !subgrp) {
        throw new Error(
          'Format nomor kas gantung (grp/subgrp) tidak ditemukan',
        );
      }

      const nomorBuktiKasGantung =
        await this.runningNumberService.generateRunningNumber(
          trx,
          grp,
          subgrp,
          this.tableName,
          insertData.tglbukti,
          cabangId,
        );

      const pengeluaranHeaderData = {
        tglbukti: data.tglbukti,
        keterangan: insertData.keterangan,
        relasi_id: insertData.relasi_id,
        bank_id: insertData.bank_id,
        alatbayar_id: insertData.alatbayar_id,
        modifiedby: insertData.modifiedby,
      };

      console.log('pengeluaranHeaderData', pengeluaranHeaderData);
      console.log('nomorBuktiKasGantung', nomorBuktiKasGantung);

      const pengeluaranDetails = details.map((detail: any) => ({
        id: 0,
        coadebet: parameter.coa_nama ?? null,
        keterangan: detail.keterangan ?? null,
        nominal: detail.nominal ?? null,
        dpp: detail.dpp ?? 0,
        transaksibiaya_nobukti: detail.transaksibiaya_nobukti ?? null,
        transaksilain_nobukti: detail.transaksilain_nobukti ?? null,
        noinvoiceemkl: detail.noinvoiceemkl ?? null,
        tglinvoiceemkl: detail.tglinvoiceemkl ?? null,
        nofakturpajakemkl: detail.nofakturpajakemkl ?? null,
        perioderefund: detail.perioderefund ?? null,
        pengeluaranemklheader_nobukti:
          detail.pengeluaranemklheader_nobukti ?? null,
        penerimaanemklheader_nobukti:
          detail.penerimaanemklheader_nobukti ?? null,
        info: detail.info ?? null,
        modifiedby: insertData.modifiedby ?? null,
        kasgantung_nobukti: nomorBuktiKasGantung ?? null,
      }));

      const pengeluaranData = {
        ...pengeluaranHeaderData,
        details: pengeluaranDetails,
      };

      console.log('[KASGANTUNG] Creating pengeluaran header...');
      const pengeluaranStartTime = Date.now();
      const pengeluaranResult = await this.pengeluaranheaderService.create(
        pengeluaranData,
        trx,
      );
      console.log(
        '[KASGANTUNG] Pengeluaran created in',
        Date.now() - pengeluaranStartTime,
        'ms',
      );

      const pengeluaranNoBukti = pengeluaranResult?.newItem?.nobukti;

      if (!pengeluaranNoBukti) {
        throw new Error('Gagal membuat pengeluaran: nobukti tidak terbentuk');
      }

      const pengeluaranDetailItems = await trx('pengeluarandetail')
        .select('id')
        .where('nobukti', pengeluaranNoBukti)
        .orderBy('id');

      if (pengeluaranDetailItems.length !== details.length) {
        throw new Error('Jumlah detail pengeluaran tidak sesuai dengan input');
      }

      insertData.nobukti = nomorBuktiKasGantung;
      insertData.pengeluaran_nobukti = pengeluaranNoBukti;

      // Insert data ke kas gantung header
      const insertedKasGantungItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

      const newHeaderId = insertedKasGantungItems?.[0]?.id;
      if (!newHeaderId) {
        throw new Error('Insert kas gantung header gagal');
      }

      if ((details || []).length > 0) {
        const detailsWithNobukti = details.map(
          (detail: any, index: number) => ({
            ...detail,
            nobukti: nomorBuktiKasGantung,
            modifiedby: detail.modifiedby ?? insertData.modifiedby,
            pengeluarandetail_id: pengeluaranDetailItems[index]?.id ?? null,
          }),
        );

        await this.kasgantungdetailService.create(
          detailsWithNobukti,
          newHeaderId,
          trx,
        );
      }

      console.log('[KASGANTUNG] Starting findAll for Redis update...');
      const { data: filteredItems } = await this.findAll(
        {
          search,
          filters,
          pagination: { page, limit: limit || 10 },
          sort: { sortBy, sortDirection },
          isLookUp: false,
        },
        trx,
      );
      console.log(
        '[KASGANTUNG] FindAll completed, items:',
        filteredItems.length,
      );

      // Skip Redis update jika data terlalu besar (optimasi performance)
      let itemIndex = 0;
      let pageNumber = 1;

      if (filteredItems.length <= 1000) {
        // Cari index item baru di hasil yang sudah difilter
        itemIndex = filteredItems.findIndex(
          (item) => String(item.id) === String(newHeaderId),
        );
        if (itemIndex === -1) itemIndex = 0;

        pageNumber = Math.floor(itemIndex / (limit || 10)) + 1;
        const endIndex = pageNumber * (limit || 10);
        const limitedItems = filteredItems.slice(0, endIndex);

        // Simpan ke Redis
        console.log('[KASGANTUNG] Saving to Redis...');
        await this.redisService.set(
          `${this.tableName}-allItems`,
          JSON.stringify(limitedItems),
        );
        console.log('[KASGANTUNG] Redis save completed');
      } else {
        console.log('[KASGANTUNG] Skipping Redis update - dataset too large');
      }

      const newItem = insertedKasGantungItems[0];

      await this.statuspendukungService.create(
        this.tableName,
        newItem.id,
        data.modifiedby,
        trx,
      );

      // Log trail untuk kas gantung
      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD KAS GANTUNG HEADER`,
          idtrans: newHeaderId,
          nobuktitrans: newHeaderId,
          aksi: 'ADD',
          datajson: JSON.stringify(insertedKasGantungItems[0]),
          modifiedby: insertedKasGantungItems[0]?.modifiedby,
        },
        trx,
      );

      console.log(
        '[KASGANTUNG] Total execution time:',
        Date.now() - startTime,
        'ms',
      );

      return {
        newItem: {
          ...insertedKasGantungItems[0],
          pengeluaran_data: pengeluaranResult.newItem,
        },
        pageNumber,
        itemIndex,
        pengeluaran_nobukti: pengeluaranNoBukti,
        kasgantung_nobukti: nomorBuktiKasGantung,
      };
    } catch (error) {
      console.error('Error in kas gantung create:', error);
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
        t.string('pengeluaran_nobukti').nullable();
        t.text('link').nullable();
      });
      const url = 'pengeluaran';

      await trx(tempUrl).insert(
        trx
          .select(
            'u.id',
            'u.pengeluaran_nobukti',
            trx.raw(`
                    STRING_AGG(
                      '<a target="_blank" className="link-color" href="/dashboard/${url}' + ${tandatanya} + 'nobukti=' + u.pengeluaran_nobukti + '">' +
                      '<HighlightWrapper value="' + u.pengeluaran_nobukti + '" />' +
                      '</a>', ','
                    ) AS link
                  `),
          )
          .from(this.tableName + ' as u')
          .groupBy('u.id', 'u.pengeluaran_nobukti'),
      );

      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.nobukti', // nobukti (nvarchar(100))
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.keterangan', // keterangan (text)
          'u.relasi_id', // relasi_id (integer)
          'u.bank_id', // bank_id (integer)
          'u.pengeluaran_nobukti', // pengeluaran_nobukti (nvarchar(100))
          'u.coakaskeluar', // coakaskeluar (nvarchar(100))
          'u.dibayarke', // dibayarke (text)
          'u.alatbayar_id', // alatbayar_id (integer)
          'u.nowarkat', // nowarkat (nvarchar(100))
          'u.tgljatuhtempo', // tgljatuhtempo (date)
          'u.gantungorderan_nobukti', // gantungorderan_nobukti (nvarchar(100))
          'u.info', // info (text)
          'u.modifiedby', // modifiedby (varchar(200))
          'u.editing_by', // editing_by (varchar(200))
          'r.nama as relasi_nama', // relasi_nama (varchar(200))
          'b.nama as bank_nama', // bank_nama (varchar(200))
          'ab.nama as alatbayar_nama', // alatbayar_nama (varchar(200))
          trx.raw("TO_CHAR(u.editing_at, 'DD-MM-YYYY HH24:MI:SS') as editing_at"), // editing_at (datetime)
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"), // created_at (datetime)
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"), // updated_at (datetime)
          'tempUrl.link',
        ])
        .innerJoin(
          trx.raw(`${tempUrl} as tempUrl`),
          'u.pengeluaran_nobukti',
          'tempUrl.pengeluaran_nobukti',
        )
        .leftJoin('relasi as r', 'u.relasi_id', 'r.id')
        .leftJoin('bank as b', 'u.bank_id', 'b.id')
        .leftJoin('alatbayar as ab', 'u.alatbayar_id', 'ab.id');

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
      const excludeSearchKeys = ['tglDari', 'tglSampai'];
      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }
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

          // Menambahkan pengecualian untuk 'tglDari' dan 'tglSampai'
          if (key === 'tglDari' || key === 'tglSampai') {
            continue; // Lewati filter jika key adalah 'tglDari' atau 'tglSampai'
          }

          if (value) {
            if (
              key === 'created_at' ||
              key === 'updated_at' ||
              key === 'editing_at' ||
              key === 'tglbukti' ||
              key === 'tgljatuhtempo'
            ) {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'relasi_nama') {
              query.andWhere('r.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'bank_nama') {
              query.andWhere('b.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'alatbayar_nama') {
              query.andWhere('ab.nama', 'like', `%${sanitizedValue}%`);
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
  async findOne(id: string, trx: any) {
    try {
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.nobukti', // nobukti (nvarchar(100))
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.keterangan', // keterangan (text)
          'u.relasi_id', // relasi_id (integer)
          'u.bank_id', // bank_id (integer)
          'u.pengeluaran_nobukti', // pengeluaran_nobukti (nvarchar(100))
          'u.coakaskeluar', // coakaskeluar (nvarchar(100))
          'u.dibayarke', // dibayarke (text)
          'u.alatbayar_id', // alatbayar_id (integer)
          'u.nowarkat', // nowarkat (nvarchar(100))
          'u.tgljatuhtempo', // tgljatuhtempo (date)
          'u.gantungorderan_nobukti', // gantungorderan_nobukti (nvarchar(100))
          'u.info', // info (text)
          'u.modifiedby', // modifiedby (varchar(200))
          'u.editing_by', // editing_by (varchar(200))
          'r.nama as relasi_nama', // relasi_nama (varchar(200))
          'b.nama as bank_nama', // bank_nama (varchar(200))
          'ab.nama as alatbayar_nama', // alatbayar_nama (varchar(200))
          trx.raw("TO_CHAR(u.editing_at, 'DD-MM-YYYY HH24:MI:SS') as editing_at"), // editing_at (datetime)
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"), // created_at (datetime)
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"), // updated_at (datetime)
        ])
        .leftJoin('relasi as r', 'u.relasi_id', 'r.id')
        .leftJoin('bank as b', 'u.bank_id', 'b.id')
        .leftJoin('alatbayar as ab', 'u.alatbayar_id', 'ab.id')
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

  async getKasGantung(dari: any, sampai: any, trx: any) {
    try {
      const tglDariFormatted = formatDateToSQL(dari);
      const tglSampaiFormatted = formatDateToSQL(sampai);
      const temp = '##temp_' + Math.random().toString(36).substring(2, 8);
      await trx.schema.createTable(temp, (t) => {
        t.string('nobukti');
        t.date('tglbukti');
        t.bigInteger('sisa').nullable();
        t.text('keterangan').nullable();
      });
      await trx(temp).insert(
        trx
          .select(
            'kd.nobukti',
            trx.raw('CAST(kg.tglbukti AS DATE) AS tglbukti'),
            trx.raw(`
              (SELECT (sum(kd.nominal) - COALESCE(SUM(pgd.nominal), 0)) 
               FROM pengembaliankasgantungdetail as pgd 
               WHERE pgd.kasgantung_nobukti = kd.nobukti) AS sisa, 
              MAX(kd.keterangan)
            `),
          )
          .from('kasgantungdetail as kd')
          .leftJoin('kasgantungheader as kg', 'kg.id', 'kd.kasgantung_id')
          .whereBetween('kg.tglbukti', [tglDariFormatted, tglSampaiFormatted])
          .groupBy('kd.nobukti', 'kg.tglbukti')
          .orderBy('kg.tglbukti', 'asc')
          .orderBy('kd.nobukti', 'asc'),
      );
      const result = trx
        .select(
          trx.raw(`row_number() OVER (ORDER BY ??) as id`, [`${temp}.nobukti`]),
          trx.raw(`FORMAT([${temp}].[tglbukti], 'dd-MM-yyyy') as tglbukti`),
          `${temp}.nobukti`,
          `${temp}.sisa`,
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
  async getPengembalian(id: any, dari: any, sampai: any, trx: any) {
    try {
      // Create temporary tables
      const tempPribadi = await this.createTempPengembalianKasGantung(
        id,
        dari,
        sampai,
        trx,
      );
      const tempAll = await this.createTempPengembalian(id, dari, sampai, trx);

      const temp = '##tempGet' + Math.random().toString(36).substring(2, 8);
      // Fetch data from the personal temporary table
      const pengembalian = trx(tempPribadi).select(
        'pengembaliankasgantungheader_id',
        'nobukti',
        'tglbukti',
        'keterangan',
        'coa',
        'sisa',
        'bayar',
        'penerimaandetail_id',
      );

      // Create a new temporary table
      await trx.schema.createTable(temp, (t) => {
        t.bigInteger('pengembaliankasgantungheader_id').nullable();
        t.string('nobukti');
        t.date('tglbukti').nullable();
        t.string('keterangan').nullable();
        t.string('coa').nullable();
        t.bigInteger('sisa').nullable();
        t.bigInteger('bayar').nullable();
        t.string('penerimaandetail_id').nullable();
      });

      // Insert fetched data into the new table
      await trx(temp).insert(pengembalian);

      // Fetch data from the second temporary table (tempAll)
      const pinjaman = trx(tempAll)
        .select(
          trx.raw('null as pengembaliankasgantungheader_id'),
          'nobukti',
          'tglbukti',
          'keterangan',
          trx.raw('null as coa'),
          'sisa',
          trx.raw('0 as bayar'),
          trx.raw('null as penerimaandetail_id'),
        )
        .where(function () {
          this.whereRaw(`${tempAll}.sisa != 0`).orWhereRaw(
            `${tempAll}.sisa is null`,
          );
        });

      // Insert data from tempAll into the new temporary table
      await trx(temp).insert(pinjaman);

      // Final data query with row numbering
      const data = await trx
        .select(
          trx.raw(`row_number() OVER (ORDER BY ??) as id`, [`${temp}.nobukti`]),
          `${temp}.pengembaliankasgantungheader_id`,
          `${temp}.nobukti`,
          trx.raw(`TO_CHAR(${temp}.tglbukti, 'DD-MM-YYYY') as tglbukti`),
          `${temp}.keterangan as keterangan`,
          `${temp}.coa as coadetail`,
          `${temp}.sisa`,
          `${temp}.bayar as nominal`,
          `${temp}.penerimaandetail_id`,
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
      const temp = '##temp_' + Math.random().toString(36).substring(2, 8);

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
               FROM pengembaliankasgantungdetail as pgd 
               WHERE pgd.kasgantung_nobukti = kd.nobukti) AS sisa, 
              MAX(kd.keterangan)
            `),
          )
          .from('kasgantungdetail as kd')
          .leftJoin('kasgantungheader as kg', 'kg.nobukti', 'kd.nobukti')
          .whereRaw(
            'kg.nobukti not in (select kasgantung_nobukti from pengembaliankasgantungdetail where pengembaliankasgantung_id=?)',
            [id],
          )
          .whereBetween('kg.tglbukti', [tglDariFormatted, tglSampaiFormatted])
          .groupBy('kd.nobukti', 'kg.tglbukti'),
      );
      return temp;
    } catch (error) {
      console.error('Error creating tempPengembalianKasGantung:', error);
      throw new Error('Failed to create tempPengembalianKasGantung');
    }
  }
  async createTempPengembalianKasGantung(
    id: any,
    dari: any,
    sampai: any,
    trx: any,
  ) {
    try {
      const tglDariFormatted = formatDateToSQL(dari);
      const tglSampaiFormatted = formatDateToSQL(sampai);
      const temp = '##temp_' + Math.random().toString(36).substring(2, 8);

      // Create temp table for 'pengembalian2'
      await trx.schema.createTable(temp, (t) => {
        t.bigInteger('pengembaliankasgantungheader_id').nullable();
        t.string('nobukti');
        t.date('tglbukti');
        t.bigInteger('bayar').nullable();
        t.string('keterangan').nullable();
        t.string('coa').nullable();
        t.bigInteger('sisa').nullable();
        t.string('penerimaandetail_id').nullable();
      });

      // Insert data into temp table for 'pengembalian2'
      await trx(temp).insert(
        trx
          .select(
            'pgd.pengembaliankasgantung_id as pengembaliankasgantungheader_id',
            'kd.nobukti',
            trx.raw('CAST(kg.tglbukti AS DATE) AS tglbukti'),
            trx.raw(`
              pgd.nominal as bayar,
              pgd.keterangan as keterangan,
              pgh.coakasmasuk as coa,
              (SELECT (sum(kd.nominal) - COALESCE(SUM(pgd.nominal), 0)) 
               FROM pengembaliankasgantungdetail as pgd 
               WHERE pgd.kasgantung_nobukti = kd.nobukti) AS sisa,
              pgd.penerimaandetail_id
            `),
          )
          .from('kasgantungdetail as kd')
          .leftJoin('kasgantungheader as kg', 'kg.id', 'kd.kasgantung_id')
          .leftJoin(
            'pengembaliankasgantungdetail as pgd',
            'pgd.kasgantung_nobukti',
            'kd.nobukti',
          )
          .leftJoin(
            'pengembaliankasgantungheader as pgh',
            'pgh.id',
            'pgd.pengembaliankasgantung_id',
          )
          .whereBetween('kg.tglbukti', [tglDariFormatted, tglSampaiFormatted])
          .where('pgd.pengembaliankasgantung_id', id)
          .groupBy(
            'pgd.pengembaliankasgantung_id',
            'kd.nobukti',
            'kg.tglbukti',
            'pgd.nominal',
            'pgd.keterangan',
            'pgh.coakasmasuk',
            'pgd.penerimaandetail_id',
          ),
      );

      return temp;
    } catch (error) {
      console.error('Error creating tempPengembalian:', error);
      throw new Error('Failed to create tempPengembalian');
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
        relasi_nama,
        bank_nama,
        alatbayar_nama,
        details,
        ...insertData
      } = data;

      Object.keys(insertData).forEach((key) => {
        if (typeof insertData[key] === 'string') {
          insertData[key] = insertData[key].toUpperCase();
        }
      });

      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';

      const formatpengeluarangantung = await trx(`bank as b`)
        .select('p.grp', 'p.subgrp', 'b.formatpengeluarangantung')
        .leftJoin('parameter as p', 'p.id', 'b.formatpengeluarangantung')
        .where('b.id', insertData.bank_id)
        .first();

      const parameter = await trx('parameter')
        .select(
          'grp',
          'subgrp',
          trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
          trx.raw(`JSON_VALUE(${memoExpr}, '$.COA') AS coa_nama`),
        )
        .where('id', formatpengeluarangantung.formatpengeluarangantung)
        .first();

      const existingData = await trx(this.tableName).where('id', id).first();
      const pengeluaranData = await trx('pengeluaranheader')
        .where('nobukti', insertData.pengeluaran_nobukti)
        .first();

      const hasChanges = this.utilsService.hasChanges(insertData, existingData);

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(insertData);
      }

      const detailPengeluaran = details.map((detail: any) => {
        const { pengeluarandetail_id, ...rest } = detail;

        return {
          ...rest,
          id: pengeluarandetail_id,
          coadebet: parameter.coa_nama ?? null,
          keterangan: detail.keterangan ?? null,
          nominal: detail.nominal ?? null,
          dpp: detail.dpp ?? 0,
          modifiedby: insertData.modifiedby ?? null,
          kasgantung_nobukti: insertData.nobukti ?? null,
        };
      });

      // Update pengeluaran header dan detail
      const dataPengeluaran = {
        tglbukti: data.tglbukti,
        relasi_id: insertData.relasi_id,
        keterangan: insertData.keterangan,
        bank_id: insertData.bank_id,
        alatbayar_id: insertData.alatbayar_id,
        modifiedby: insertData.modifiedby,
        details: detailPengeluaran,
      };
      console.log(dataPengeluaran, 'cek');
      const updatedPengeluaran = await this.pengeluaranheaderService.update(
        pengeluaranData.id,
        dataPengeluaran,
        trx,
      );

      // Handle kas gantung detail - hanya field yang dibutuhkan
      if (details && details.length > 0) {
        const existingDetails = await trx('kasgantungdetail').where(
          'kasgantung_id',
          id,
        );

        const updatedDetails = details.map((detail: any) => {
          const existingDetail = existingDetails.find(
            (existing: any) => existing.nobukti === detail.nobukti,
          );

          return {
            id: existingDetail ? existingDetail.id : 0,
            kasgantung_id: id,
            nobukti: existingData.nobukti,
            keterangan: detail.keterangan,
            nominal: detail.nominal,
            modifiedby: insertData.modifiedby,
            created_at: existingDetail
              ? existingDetail.created_at
              : this.utilsService.getTime(),
            updated_at: this.utilsService.getTime(),
          };
        });

        await this.kasgantungdetailService.create(updatedDetails, id, trx);
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

      const dataDetail = await this.kasgantungdetailService.findAll(id, trx);

      // Cari index item di hasil yang sudah difilter
      let itemIndex = filteredItems.findIndex((item) => Number(item.id) === id);

      if (itemIndex === -1) {
        itemIndex = 0;
      }

      const pageNumber = Math.floor(itemIndex / limit) + 1;
      const endIndex = pageNumber * limit;

      // Ambil data hingga halaman yang mencakup item
      const limitedItems = filteredItems.slice(0, endIndex);

      // Simpan ke Redis
      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `EDIT KAS GANTUNG HEADER`,
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      return {
        updatedItem: {
          id,
          ...insertData,
          pengeluaran_data: updatedPengeluaran,
        },
        pageNumber,
        itemIndex,
        dataDetail,
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
        'kasgantungdetail',
        'kasgantung_id',
        trx,
      );

      await this.statuspendukungService.remove(id, modifiedby, trx);

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE KAS GANTUNG DETAIL',
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
        const validasi = await this.globalService.checkUsed(
          'pengembaliankasgantungdetail',
          'kasgantung_nobukti',
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

  async exportToExcel(data: any[], trx: any) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    // Header laporan
    worksheet.mergeCells('A1:E1');
    worksheet.mergeCells('A2:E2');
    worksheet.mergeCells('A3:E3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN KAS GANTUNG';
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
      const detailRes = await this.kasgantungdetailService.findAll(
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
      `laporan_kas_gantung${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
