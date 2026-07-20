import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateJurnalumumheaderDto } from './dto/create-jurnalumumheader.dto';
import { UpdateJurnalumumheaderDto } from './dto/update-jurnalumumheader.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { RedisService } from 'src/common/redis/redis.service';
import { withUuidV7, formatDateToSQL, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { JurnalumumdetailService } from '../jurnalumumdetail/jurnalumumdetail.service';
import { GlobalService } from '../global/global.service';
import { LocksService } from '../locks/locks.service';
import { Column, Workbook } from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { StatuspendukungService } from '../statuspendukung/statuspendukung.service';
@Injectable()
export class JurnalumumheaderService {
  constructor(
    // Inject wrapper RedisService (BUKAN raw 'REDIS_CLIENT'): set/get/del cache
    // jadi best-effort sehingga create/update tidak gagal 500 "Stream isn't
    // writeable" saat Redis mati. Lihat pengeluaranheader.service.ts.
    private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly jurnalumumdetailService: JurnalumumdetailService,
    private readonly statuspendukungService: StatuspendukungService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
  ) {}
  private readonly tableName = 'jurnalumumheader';
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
        isreload,
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
      ['nobukti', 'keterangan', 'postingdari'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      // **HELPER FUNCTION: Parse currency string to number**
      const parseCurrency = (value: any): number => {
        if (value === null || value === undefined || value === '') {
          return 0;
        }
        if (typeof value === 'number') {
          return value;
        }
        if (typeof value === 'string') {
          const cleanValue = value.replace(/[^0-9.-]/g, '');
          const parsed = parseFloat(cleanValue);
          return isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      };

      // **PROSES DETAILS DAN VALIDASI BALANCE**
      if (details && details.length > 0) {
        let totalDebet = 0;
        let totalKredit = 0;

        const processedDetails = details.map((detail: any, index: number) => {
          const nominalDebetValue = parseCurrency(detail.nominaldebet);
          const nominalKreditValue = parseCurrency(detail.nominalkredit);

          if (nominalDebetValue === 0 && nominalKreditValue === 0) {
            throw new HttpException(
              {
                statusCode: HttpStatus.BAD_REQUEST,
                message: `Line ${index + 1}: Nominal Debet atau Kredit harus diisi`,
                error: 'Bad Request',
              },
              HttpStatus.BAD_REQUEST,
            );
          }

          if (nominalDebetValue > 0 && nominalKreditValue > 0) {
            throw new HttpException(
              {
                statusCode: HttpStatus.BAD_REQUEST,
                message: `Line ${index + 1}: Tidak boleh mengisi Debet dan Kredit bersamaan`,
                error: 'Bad Request',
              },
              HttpStatus.BAD_REQUEST,
            );
          }

          const { nominaldebet, nominalkredit, ...cleanDetail } = detail;
          if (nominalDebetValue > 0) {
            cleanDetail.nominal = nominalDebetValue;
            totalDebet += nominalDebetValue;
          } else if (nominalKreditValue > 0) {
            cleanDetail.nominal = nominalKreditValue * -1;
            totalKredit += nominalKreditValue;
          }

          return cleanDetail;
        });

        const selisih = totalDebet - totalKredit;
        const tolerance = 0.01;

        if (Math.abs(selisih) > tolerance) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: `Jurnal tidak balance!`,
              error: 'Bad Request',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        data.details = processedDetails;
      } else {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Detail jurnal tidak boleh kosong',
            error: 'Bad Request',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!insertData.nobukti) {
        const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
        const parameter = await trx('parameter')
          .select(
            'grp',
            'subgrp',
            trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
          )
          .where('grp', 'NOMOR PENERIMAAN')
          .andWhere('subgrp', 'NOMOR PENERIMAAN JURNAL')
          .first();

        const nomorBukti =
          await this.runningNumberService.generateRunningNumber(
            trx,
            parameter.grp,
            parameter.subgrp,
            this.tableName,
            insertData.tglbukti,
          );

        insertData.nobukti = nomorBukti;
        insertData.postingdari = parameter.memo_nama;
      }

      // 1. INSERT KE TABLE UTAMA
      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

      if (data.details && data.details.length > 0) {
        const detailsWithNobukti = data.details.map((detail: any) => ({
          ...detail,
          nobukti: insertData.nobukti,
          tglbukti: insertData.tglbukti,
          modifiedby: insertData.modifiedby,
        }));
        await this.jurnalumumdetailService.create(
          detailsWithNobukti,
          insertedItems[0].id,
          trx,
        );
      }

      const newItem = insertedItems[0];

      // ── Posisi/pagination + status pasca-simpan (NON-FATAL) ──────────────
      // Header + detail jurnal SUDAH ter-insert di atas. Blok di bawah hanya
      // menghitung posisi baris di grid via findOne/findAll — yang memakai mesin
      // PIVOT + JSON_VALUE warisan MSSQL (tempStatusPendukung) dan bisa gagal
      // "query is empty" untuk record baru. Kegagalannya TIDAK boleh me-rollback
      // simpan yang sudah berhasil (return blok ini diabaikan pemanggil dari alur
      // pengeluaran). Default posisi bila gagal.
      let newItemFormatted: any = { data: [newItem] };
      let pageNumber = 1;
      let itemIndex = 0;
      try {
        await this.statuspendukungService.create(
          this.tableName,
          newItem.id,
          data.modifiedby,
          trx,
        );

        newItemFormatted = await this.findOne(newItem.id, trx);
        const tempJurnalumumheader = `temp_jurnalumumheader${insertData.modifiedby}`;
        const tempTableExists = await trx.schema.hasTable(tempJurnalumumheader);
        if (!tempTableExists) {
          await trx.schema.createTable(tempJurnalumumheader, (t) => {
            t.string('id').nullable();
            t.string('nobukti').nullable();
            t.string('tglbukti').nullable();
            t.string('keterangan').nullable();
            t.string('postingdari').nullable();
            t.string('statusformat').nullable();
            t.string('keteranganapproval').nullable();
            t.string('tglapproval').nullable();
            t.string('statusapproval').nullable();
            t.string('keterangancetak').nullable();
            t.string('tglcetak').nullable();
            t.string('statuscetak').nullable();
            t.string('statusapproval_id').nullable();
            t.string('statuscetak_id').nullable();
            t.string('info').nullable();
            t.string('modifiedby').nullable();
            t.string('updated_at').nullable();
            t.string('created_at').nullable();
          });
          const payloadtemptable = {
            namatabel: tempJurnalumumheader,
            namamenu: this.tableName,
            modifiedby: insertData.modifiedby,
            created_at: this.utilsService.getTime(),
            updated_at: this.utilsService.getTime(),
          };
          await trx('listtemporarytable').insert(
            await withUuidV7(trx, payloadtemptable),
          );
        }

        await trx(tempJurnalumumheader).insert(newItemFormatted.data);
        const { data: filteredItems } = await this.findAll(
          {
            search,
            filters,
            pagination: { page, limit: 0 },
            sort: { sortBy, sortDirection },
            isLookUp: false,
          },
          trx,
          isreload,
          insertData.modifiedby,
        );
        itemIndex = filteredItems.findIndex(
          (item) => String(item.id) === String(newItem.id),
        );
        if (itemIndex === -1) itemIndex = 0;
        pageNumber = limit > 0 ? Math.floor(itemIndex / limit) + 1 : 1;
        const endIndex = limit > 0 ? pageNumber * limit : filteredItems.length;
        const limitedItems = filteredItems.slice(0, endIndex);
        await this.redisService.set(
          `${this.tableName}-allItems`,
          JSON.stringify(limitedItems),
        );
      } catch (posErr: any) {
        console.warn(
          'jurnalumumheader: komputasi posisi/status pasca-simpan gagal (non-fatal):',
          posErr?.message,
        );
      }

      // 9. CREATE STATUS PENDUKUNG

      // 10. LOG TRAIL
      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD JURNAL UMUM HEADER`,
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      return {
        newItem: newItemFormatted,
        pageNumber,
        itemIndex,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Internal server error',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  async findAll(
    { search, filters, pagination, sort, isLookUp }: FindAllParams,
    trx: any,
    isreload: any,
    modifiedby: string,
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

      const tempJurnalumumheader = `temp_jurnalumumheader${modifiedby}`;
      let data;
      let total;
      console.log('isreload', isreload, typeof isreload);

      if (isreload === 'false') {
        // Ambil data dari temp table dengan filter, search, sorting, dan paging
        console.log('masuk3');

        // PERBAIKAN: Buat query builder terpisah untuk count
        const buildFilteredQuery = (queryBuilder: any) => {
          // Apply date range filter
          if (filters?.tglDari && filters?.tglSampai) {
            const tglDariFormatted = formatDateToSQL(String(filters?.tglDari));
            const tglSampaiFormatted = formatDateToSQL(
              String(filters?.tglSampai),
            );

            queryBuilder.whereRaw(
              `CONVERT(DATE, tglbukti, 105) BETWEEN ? AND ?`,
              [tglDariFormatted, tglSampaiFormatted],
            );
          }

          // Apply search
          const excludeSearchKeys = ['tglDari', 'tglSampai'];
          const searchFields = Object.keys(filters || {}).filter(
            (k) => !excludeSearchKeys.includes(k),
          );

          if (search) {
            const sanitized = String(search).replace(/\[/g, '[[]').trim();

            queryBuilder.where((qb) => {
              searchFields.forEach((field) => {
                qb.orWhere(field, 'like', `%${sanitized}%`);
              });
            });
          }

          // Apply filters
          if (filters) {
            for (const [key, value] of Object.entries(filters)) {
              const sanitizedValue = String(value).replace(/\[/g, '[[]');

              if (key === 'tglDari' || key === 'tglSampai') {
                continue;
              }

              if (value) {
                queryBuilder.andWhere(key, 'like', `%${sanitizedValue}%`);
              }
            }
          }

          return queryBuilder;
        };

        // Query untuk COUNT (tanpa select *)
        const countQuery = trx(tempJurnalumumheader);
        buildFilteredQuery(countQuery);
        const result = await countQuery.count('id as total').first();
        total = result?.total as number;

        // Query untuk DATA (dengan select *)
        const tempQuery = trx(tempJurnalumumheader).select('*');
        buildFilteredQuery(tempQuery);

        // Apply sorting
        if (sort?.sortBy && sort?.sortDirection) {
          tempQuery.orderBy(sort.sortBy, sort.sortDirection);
        }

        // Apply pagination
        if (limit > 0) {
          const offset = (page - 1) * limit;
          tempQuery.limit(limit).offset(offset);
        }

        data = await tempQuery;
        console.log('data', data);
      } else {
        // Ambil data dari query utama
        const dataTempStatusPendukung = await this.tempStatusPendukung(
          trx,
          this.tableName,
        );
        const query = trx(`${this.tableName} as u`)
          .select([
            'u.id as id',
            'u.nobukti',
            trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
            'u.keterangan',
            'u.postingdari',
            'u.statusformat',
            'u.info',
            'u.modifiedby',
            trx.raw(
              "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
            ),
            trx.raw(
              "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
            ),
            'd.keterangan as keteranganapproval',
            'd.tglapproval as tglapproval',
            'd.statusapproval as statusapproval',
            'd.keterangan_cetak as keterangancetak',
            'd.tglcetak as tglcetak',
            'd.statuscetak as statuscetak',
            'd.statusapproval_id as statusapproval_id',
            'd.statuscetak_id as statuscetak_id',
          ])
          .innerJoin(
            `${dataTempStatusPendukung} as d`,
            'u.nobukti',
            'd.nobukti',
          );

        if (filters?.tglDari && filters?.tglSampai) {
          const tglDariFormatted = formatDateToSQL(String(filters?.tglDari));
          const tglSampaiFormatted = formatDateToSQL(
            String(filters?.tglSampai),
          );

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
              qb.orWhere(`u.${field}`, 'like', `%${sanitized}%`);
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
              if (
                key === 'created_at' ||
                key === 'updated_at' ||
                key === 'tglbukti'
              ) {
                query.andWhereRaw(
                  "TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?",
                  [key, `%${sanitizedValue}%`],
                );
              } else if (key === 'statusapproval') {
                query.andWhere(
                  'd.statusapproval_id',
                  'like',
                  `%${sanitizedValue}%`,
                );
              } else if (key === 'statuscetak') {
                query.andWhere(
                  'd.statuscetak_id',
                  'like',
                  `%${sanitizedValue}%`,
                );
              } else {
                query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
              }
            }
          }
        }

        // Drop dan create temp table
        await trx.schema.dropTableIfExists(tempJurnalumumheader);

        await trx.schema.createTable(tempJurnalumumheader, (t) => {
          // id jurnalumumheader = varchar(200) UUID, bukan bigint (pasca migrasi
          // id ke UUID). bigInteger -> insert UUID gagal "converting nvarchar to
          // bigint".
          t.string('id').nullable();
          t.string('nobukti').nullable();
          t.string('tglbukti').nullable();
          t.string('keterangan').nullable();
          t.string('postingdari').nullable();
          t.string('statusformat').nullable();
          t.string('keteranganapproval').nullable();
          t.string('tglapproval').nullable();
          t.string('statusapproval').nullable();
          t.string('keterangancetak').nullable();
          t.string('tglcetak').nullable();
          t.string('statuscetak').nullable();
          t.string('statusapproval_id').nullable();
          t.string('statuscetak_id').nullable();
          t.string('info').nullable();
          t.string('modifiedby').nullable();
          t.string('updated_at').nullable();
          t.string('created_at').nullable();
        });

        // Hapus data lama jika namatabel dan namamenu sudah ada
        await trx('listtemporarytable')
          .where('namamenu', this.tableName)
          .andWhere('modifiedby', modifiedby)
          .delete();

        const payloadtemptable = {
          namatabel: tempJurnalumumheader,
          namamenu: this.tableName,
          modifiedby: modifiedby,
          created_at: this.utilsService.getTime(),
          updated_at: this.utilsService.getTime(),
        };
        await trx('listtemporarytable').insert(
        await withUuidV7(trx, payloadtemptable),
      );

        const result = await trx(this.tableName).count('id as total').first();
        total = result?.total as number;

        if (sort?.sortBy && sort?.sortDirection) {
          query.orderBy(sort.sortBy, sort.sortDirection);
        }

        if (limit > 0) {
          const offset = (page - 1) * limit;
          query.limit(limit).offset(offset);
        }

        data = await query;
        await trx(tempJurnalumumheader).insert(data);

        // tempHasil = tabel PERMANEN di PG; buang atau bocor tiap request.
        await trx.schema.dropTableIfExists(dataTempStatusPendukung);
      }

      const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
      const responseType = Number(total) > 500 ? 'json' : 'local';
      console.log('data222', data);

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

  async tempStatusPendukung(trx: any, tablename: string) {
    try {
      const tempStatusPendukung = `##temp_${Math.random().toString(36).substring(2, 15)}`;
      const tempData = `##temp_data${Math.random().toString(36).substring(2, 15)}`;
      const tempHasil = `##temp_hasil${Math.random().toString(36).substring(2, 15)}`;

      // Create tempStatusPendukung table
      await trx.schema.createTable(tempStatusPendukung, (t) => {
        // id/statusdatapendukung/transaksi_id di tabel statuspendukung adalah
        // varchar(200) UUID (pasca migrasi id ke UUID), BUKAN bigint. Memakai
        // bigInteger di temp table -> insert UUID gagal "converting varchar to
        // bigint" -> findAll jurnal 500 (ikut menggagalkan create pengeluaran
        // yang membuat jurnal). Samakan ke string.
        t.string('id').nullable();
        t.string('statusdatapendukung').nullable();
        t.string('transaksi_id').nullable();
        t.string('statuspendukung').nullable();
        t.text('keterangan').nullable();
        t.string('modifiedby').nullable();
        t.string('updated_at').nullable();
        t.string('created_at').nullable();
      });

      // Create tempHasil table
      await trx.schema.createTable(tempData, (t) => {
        t.string('nobukti').nullable();
        t.text('keterangan').nullable();
        t.string('judul').nullable();
      });
      await trx.schema.createTable(tempHasil, (t) => {
        t.string('nobukti').nullable();
        t.text('statusapproval').nullable();
        t.text('statuscetak').nullable();
        t.text('keterangan').nullable();
        t.string('statusapproval_id').nullable();
        t.string('tglapproval').nullable();
        t.string('keterangan_cetak').nullable();
        t.string('statuscetak_id').nullable();
        t.string('tglcetak').nullable();
      });

      // Insert into tempStatusPendukung
      await trx(tempStatusPendukung).insert(
        trx
          .select(
            'a.id',
            'a.statusdatapendukung',
            'a.transaksi_id',
            'a.statuspendukung',
            'a.keterangan',
            'a.modifiedby',
            'a.updated_at',
            'a.created_at',
          )
          .from('statuspendukung as a')
          .innerJoin('parameter as b', 'a.statusdatapendukung', 'b.id')
          .where('b.subgrp', tablename),
      );

      await trx(tempData).insert(
        trx
          .select(
            'a.nobukti',
            trx.raw(
              `CONCAT(
                '{"statusdatapendukung":"',
                CASE 
                  WHEN (CAST(c.memo AS text) IS JSON) 
                    THEN JSON_VALUE(CAST(c.memo AS text), '$.MEMO') 
                  ELSE '' 
                END,
                '","transaksi_id":"',
                TRIM(COALESCE(b.transaksi_id, '')),
                '","statuspendukung":"',
                CASE 
                  WHEN (CAST(d.memo AS text) IS JSON) 
                    THEN JSON_VALUE(CAST(d.memo AS text), '$.MEMO') 
                  ELSE '' 
                END,
                '","keterangan":"',
                TRIM(COALESCE(b.keterangan, '')),
                '","updated_at":"',
                TO_CHAR(CAST(b.updated_at AS timestamp), 'YYYY-MM-DD HH24:MI:SS'),
                '","statuspendukung_id":"',
                TRIM(COALESCE(d.id, '')),
                '","statuspendukung_memo":',
               TRIM(CAST(d.memo AS text)),
                '}'
              ) AS keterangan`,
            ),
            trx.raw(
              `CASE 
                WHEN (CAST(c.memo AS text) IS JSON) 
                  THEN JSON_VALUE(CAST(c.memo AS text), '$.MEMO') 
                ELSE '' 
              END AS judul`,
            ),
          )
          .from('jurnalumumheader as a')
          .innerJoin(`${tempStatusPendukung} as b`, 'a.id', 'b.transaksi_id')
          .innerJoin('parameter as c', 'b.statusdatapendukung', 'c.id')
          .innerJoin('parameter as d', 'b.statuspendukung', 'd.id'),
      );

      // Generate dynamic columns for PIVOT
      const columnsResult = await trx
        .select('judul')
        .from(tempData)
        .groupBy('judul');

      let columns = '';

      columnsResult.forEach((row, index) => {
        if (index === 0) {
          columns = `[${row.judul}]`;
        } else {
          columns += `, [${row.judul}]`;
        }
      });

      if (!columns) {
        // Scratch internal sudah tak terpakai. schema.createTable di PG membuat
        // tabel PERMANEN (bukan TEMP), jadi wajib dibuang manual atau bocor tiap
        // request. tempHasil dibuang pemanggil setelah selesai di-join.
        await trx.schema.dropTableIfExists(tempStatusPendukung);
        await trx.schema.dropTableIfExists(tempData);
        return tempHasil;
      }
      const pivotSubqueryRaw = `
        (
          SELECT nobukti, ${columns}
          FROM (
            SELECT nobukti, judul, keterangan
            FROM ${tempData}
          ) AS SourceTable
          PIVOT (
            MAX(keterangan)
            FOR judul IN (${columns})
          ) AS PivotTable
        ) AS A
      `;
      await trx(tempHasil).insert(
        trx
          .select([
            'A.nobukti',
            trx.raw(
              "JSON_QUERY(A.[approval transaksi], '$.statuspendukung_memo') as statusapproval",
            ),
            trx.raw(
              "JSON_QUERY(A.[cetak], '$.statuspendukung_memo') as statuscetak",
            ),
            trx.raw(
              "JSON_VALUE(A.[approval transaksi], '$.keterangan') as keterangan",
            ),
            trx.raw(
              "JSON_VALUE(A.[approval transaksi], '$.statuspendukung_id') as statusapproval_id",
            ),
            trx.raw(
              "CAST(JSON_VALUE(A.[approval transaksi], '$.updated_at') AS DATETIME) as tglapproval",
            ),
            trx.raw(
              "JSON_VALUE(A.[cetak], '$.keterangan') as keterangan_cetak",
            ),
            trx.raw(
              "JSON_VALUE(A.[cetak], '$.statuspendukung_id') as statuscetak_id",
            ),
            trx.raw(
              "CAST(JSON_VALUE(A.[cetak], '$.updated_at') AS DATETIME) as tglcetak",
            ),
          ])
          .from(trx.raw(pivotSubqueryRaw)),
      );
      await trx.schema.dropTableIfExists(tempStatusPendukung);
      await trx.schema.dropTableIfExists(tempData);
      return tempHasil;
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }
  async findOne(id: string, trx: any) {
    try {
      const dataTempStatusPendukung = await this.tempStatusPendukung(
        trx,
        this.tableName,
      );

      const query = await trx
        .from(trx.raw(`${this.tableName} as u`))
        .select([
          'u.id as id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.keterangan',
          'u.postingdari',
          'u.statusformat',
          'u.info',
          'u.modifiedby',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'd.keterangan as keteranganapproval',
          'd.tglapproval as tglapproval',
          'd.statusapproval as statusapproval',
          'd.keterangan_cetak as keterangancetak',
          'd.tglcetak as tglcetak',
          'd.statuscetak as statuscetak',
          'd.statusapproval_id as statusapproval_id',
          'd.statuscetak_id as statuscetak_id',
        ])
        .innerJoin(`${dataTempStatusPendukung} as d`, 'u.nobukti', 'd.nobukti')
        .where('u.id', id);

      const data = await query;

      // tempHasil = tabel PERMANEN di PG; buang setelah di-join atau bocor tiap
      // request. Hasilnya sudah di-await di atas jadi aman untuk di-drop.
      await trx.schema.dropTableIfExists(dataTempStatusPendukung);

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
      data.tglbukti = formatDateToSQL(String(data?.tglbukti)); // Fungsi untuk format

      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        postingdari,
        statusformat,
        details,
        isreload,
        ...insertData
      } = data;

      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['nobukti', 'keterangan', 'postingdari'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });
      const existingData = await trx(this.tableName).where('id', id).first();
      const hasChanges = this.utilsService.hasChanges(insertData, existingData);

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();

        await trx(this.tableName).where('id', id).update(insertData);
      }
      // **HELPER FUNCTION: Parse currency string to number**
      const parseCurrency = (value: any): number => {
        if (value === null || value === undefined || value === '') {
          return 0;
        }
        if (typeof value === 'number') {
          return value;
        }
        if (typeof value === 'string') {
          const cleanValue = value.replace(/[^0-9.-]/g, '');
          const parsed = parseFloat(cleanValue);
          return isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      };

      // **PROSES DETAILS DAN VALIDASI BALANCE**
      if (details && details.length > 0) {
        let totalDebet = 0;
        let totalKredit = 0;

        // Transform details: konversi nominaldebet/nominalkredit menjadi nominal
        const processedDetails = details.map((detail: any, index: number) => {
          // Parse nominal debet dan kredit dari string currency
          const nominalDebetValue = parseCurrency(detail.nominaldebet);
          const nominalKreditValue = parseCurrency(detail.nominalkredit);

          // Validasi: minimal salah satu harus ada nilainya
          if (nominalDebetValue === 0 && nominalKreditValue === 0) {
            throw new HttpException(
              {
                statusCode: HttpStatus.BAD_REQUEST,
                message: `Line ${index + 1}: Nominal Debet atau Kredit harus diisi`,
                error: 'Bad Request',
              },
              HttpStatus.BAD_REQUEST,
            );
          }

          // Validasi: tidak boleh kedua-duanya terisi
          if (nominalDebetValue > 0 && nominalKreditValue > 0) {
            throw new HttpException(
              {
                statusCode: HttpStatus.BAD_REQUEST,
                message: `Line ${index + 1}: Tidak boleh mengisi Debet dan Kredit bersamaan`,
                error: 'Bad Request',
              },
              HttpStatus.BAD_REQUEST,
            );
          }

          // Buat object baru tanpa nominaldebet dan nominalkredit
          const { nominaldebet, nominalkredit, ...cleanDetail } = detail;

          // Set nominal berdasarkan debet atau kredit
          if (nominalDebetValue > 0) {
            cleanDetail.nominal = nominalDebetValue; // Positif untuk debet
            totalDebet += nominalDebetValue;
          } else if (nominalKreditValue > 0) {
            cleanDetail.nominal = nominalKreditValue * -1; // Negatif untuk kredit
            totalKredit += nominalKreditValue;
          }

          return cleanDetail;
        });

        // **VALIDASI BALANCE: Total Debet harus sama dengan Total Kredit**
        const selisih = totalDebet - totalKredit;
        const tolerance = 0.01;

        if (Math.abs(selisih) > tolerance) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: `Jurnal tidak balance!`,
              error: 'Bad Request',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        // Update details dengan yang sudah diproses
        data.details = processedDetails;
      } else {
        // Jika tidak ada details
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Detail jurnal tidak boleh kosong',
            error: 'Bad Request',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Check each detail, update or set id accordingly
      const detailsWithNobukti = data.details.map((detail: any) => ({
        ...detail,
        nobukti: existingData.nobukti, // Inject nobukti into each detail
        modifiedby: insertData.modifiedby,
      }));
      await this.jurnalumumdetailService.create(detailsWithNobukti, id, trx);

      // ── Posisi/pagination + status pasca-simpan (NON-FATAL) ──────────────
      // Header + detail jurnal SUDAH ter-update di atas. Blok di bawah hanya
      // menghitung posisi baris di grid via findOne/findAll — yang memakai mesin
      // PIVOT + JSON_VALUE warisan MSSQL (tempStatusPendukung). Untuk
      // jurnalumumheader TIDAK ADA satu pun parameter subgrp='jurnalumumheader',
      // jadi tempStatusPendukung selalu balik KOSONG, innerJoin di findOne
      // memulangkan 0 baris, dan throw di bawah me-rollback SELURUH edit ->
      // "INTERNAL SERVER ERROR" di layar padahal simpannya sudah benar. Sama
      // seperti di create(), kegagalan blok ini tidak boleh menggagalkan simpan
      // yang sudah berhasil (pemanggil dari alur pengeluaran mengabaikan
      // return-nya). Default posisi bila gagal.
      let pageNumber = 1;
      let itemIndex = 0;
      try {
        // Query data yang baru saja diupdate menggunakan findOne
        const { data: updatedItemData } = await this.findOne(String(id), trx);
        const updatedItemFormatted = updatedItemData[0];

        if (!updatedItemFormatted) {
          throw new Error(
            `Failed to fetch formatted data for updated item with id: ${id}`,
          );
        }

        // UPDATE TEMP TABLE
        const tempJurnalumumheader = `temp_jurnalumumheader${insertData.modifiedby}`;

        // Cek apakah temp table sudah ada
        const tempTableExists = await trx.schema.hasTable(tempJurnalumumheader);

        if (!tempTableExists) {
          // Buat temp table jika belum ada
          await trx.schema.createTable(tempJurnalumumheader, (t) => {
            // id jurnalumumheader = varchar(200) UUID, bukan bigint (pasca
            // migrasi id ke UUID). bigInteger -> insert UUID gagal "converting
            // nvarchar to bigint".
            t.string('id').nullable();
            t.string('nobukti').nullable();
            t.string('tglbukti').nullable();
            t.string('keterangan').nullable();
            t.string('postingdari').nullable();
            t.string('statusformat').nullable();
            t.string('keteranganapproval').nullable();
            t.string('tglapproval').nullable();
            t.string('statusapproval').nullable();
            t.string('keterangancetak').nullable();
            t.string('tglcetak').nullable();
            t.string('statuscetak').nullable();
            t.string('statusapproval_id').nullable();
            t.string('statuscetak_id').nullable();
            t.string('info').nullable();
            t.string('modifiedby').nullable();
            t.string('updated_at').nullable();
            t.string('created_at').nullable();
          });

          // Register di listtemporarytable
          const payloadtemptable = {
            namatabel: tempJurnalumumheader,
            namamenu: this.tableName,
            modifiedby: insertData.modifiedby,
            created_at: this.utilsService.getTime(),
            updated_at: this.utilsService.getTime(),
          };
          await trx('listtemporarytable').insert(
            await withUuidV7(trx, payloadtemptable),
          );
        }

        // Hapus data lama dari temp table jika ada
        await trx(tempJurnalumumheader).where('id', id).delete();

        // Insert data yang sudah diupdate ke temp table
        await trx(tempJurnalumumheader).insert(updatedItemFormatted);

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
          isreload,
          insertData.modifiedby,
        );

        // Cari index item di hasil yang sudah difilter. id = UUID string, jadi
        // Number(item.id) selalu NaN dan tak pernah cocok -> posisi grid selalu
        // jatuh ke baris 1. Bandingkan sebagai string.
        itemIndex = filteredItems.findIndex(
          (item) => String(item.id) === String(id),
        );

        if (itemIndex === -1) {
          itemIndex = 0;
        }

        pageNumber = Math.floor(itemIndex / limit) + 1;
        const endIndex = pageNumber * limit;

        // Ambil data hingga halaman yang mencakup item
        const limitedItems = filteredItems.slice(0, endIndex);

        // Simpan ke Redis
        await this.redisService.set(
          `${this.tableName}-allItems`,
          JSON.stringify(limitedItems),
        );
      } catch (error) {
        console.warn(
          `Update jurnalumumheader ${id} berhasil, tetapi posisi grid pasca-simpan gagal dihitung:`,
          error?.message,
        );
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `EDIT JURNAL UMUM HEADER`,
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
          ...data,
        },
        pageNumber,
        itemIndex,
      };
    } catch (error) {
      throw new Error(`${error.message}`);
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
        'jurnalumumdetail',
        'jurnalumum_id',
        trx,
      );
      await this.statuspendukungService.remove(id, modifiedby, trx);

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE JURNAL UMUM DETAIL',
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
      console.log('Error deleting data:', error);
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
    worksheet.mergeCells('A1:E1');
    worksheet.mergeCells('A2:E2');
    worksheet.mergeCells('A3:E3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN JURNAL UMUM';
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
      const detailRes = await this.jurnalumumdetailService.findAll(
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
        const tableHeaders = [
          'NO.',
          'NO BUKTI',
          'KETERANGAN',
          'COA',
          'NOMINAL DEBET',
          'NOMINAL KREDIT',
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

        details.forEach((d: any, detailIndex: number) => {
          const rowValues = [
            detailIndex + 1,
            d.nobukti ?? '',
            d.keterangan ?? '',
            d.coa ?? '',
            d.nominaldebet ?? '',
            d.nominalkredit ?? '',
          ];
          rowValues.forEach((value, colIndex) => {
            const cell = worksheet.getCell(currentRow, colIndex + 1);
            cell.value = value;
            cell.font = { name: 'Tahoma', size: 10 };

            // kolom angka rata kanan, selain itu rata kiri
            if (colIndex === 3 || colIndex === 4 || colIndex === 5) {
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
      `laporan_jurnal_umum${Date.now()}.xlsx`,
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
