import {
  Inject,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CreatePenerimaanheaderDto } from './dto/create-penerimaanheader.dto';
import { UpdatePenerimaanheaderDto } from './dto/update-penerimaanheader.dto';
import {
  withUuidV7,
  formatDateToSQL,
  parseNumberWithSeparators,
  tandatanya,
  UtilsService,
 } from 'src/utils/utils.service';
import { RedisService } from 'src/common/redis/redis.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { PenerimaandetailService } from '../penerimaandetail/penerimaandetail.service';
import { LocksService } from '../locks/locks.service';
import { GlobalService } from '../global/global.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { Column, Workbook } from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { JurnalumumheaderService } from '../jurnalumumheader/jurnalumumheader.service';
import { dbMssql } from 'src/common/utils/db';
import { PenerimaanemklheaderService } from '../penerimaanemklheader/penerimaanemklheader.service';
import { PengeluaranemklheaderService } from '../pengeluaranemklheader/pengeluaranemklheader.service';

@Injectable()
export class PenerimaanheaderService implements OnModuleInit {
  private penerimaanemklheaderService: PenerimaanemklheaderService;
  private pengeluaranemklheaderService: PengeluaranemklheaderService;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly logTrailService: LogtrailService,
    private readonly utilsService: UtilsService,
    private readonly runningNumberService: RunningNumberService,
    private readonly penerimaandetailService: PenerimaandetailService,
    private readonly globalService: GlobalService,
    private readonly locksService: LocksService,
    private readonly jurnalumumheaderService: JurnalumumheaderService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    this.penerimaanemklheaderService = this.moduleRef.get(
      PenerimaanemklheaderService,
      { strict: false },
    );
    this.pengeluaranemklheaderService = this.moduleRef.get(
      PengeluaranemklheaderService,
      { strict: false },
    );
  }

  private readonly tableName = 'penerimaanheader';
  async create(data: any, trx: any) {
    try {
      const positiveNominal = '';
      const insertData = {
        nobukti: data.nobukti ?? null,
        tglbukti: formatDateToSQL(String(data?.tglbukti)),
        relasi_id: data.relasi_id ?? null,
        keterangan: data.keterangan ?? null,
        bank_id: data.bank_id ?? null,
        postingdari: data.postingdari ?? null,
        coakasmasuk: data.coakasmasuk ?? null,
        diterimadari: data.diterimadari ?? null,
        alatbayar_id: data.alatbayar_id ?? null,
        nowarkat: data.nowarkat ?? null,
        tgllunas: formatDateToSQL(String(data?.tgllunas)),
        noresi: data.noresi ?? null,
        statusformat: data.statusformat ?? null,
        modifiedby: data.modifiedby ?? null,
        created_at: this.utilsService.getTime(),
        updated_at: this.utilsService.getTime(),
      };
      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      [
        'nobukti',
        'keterangan',
        'postingdari',
        'diterimadari',
        'nowarkat',
        'noresi',
      ].forEach((field) => {
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

      const formatpenerimaan = await trx(`bank as b`)
        .select('p.grp', 'p.subgrp', 'b.formatpenerimaan', 'b.coa')
        .leftJoin('parameter as p', 'p.id', 'b.formatpenerimaan')
        .where('b.id', insertData.bank_id)
        .first();
      const parameter = await trx('parameter')
        .select(
          'grp',
          'subgrp',
          trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
        )
        .where('id', formatpenerimaan.formatpenerimaan)
        .first();

      const grp = formatpenerimaan.grp;
      const subgrp = formatpenerimaan.subgrp;
      const cabangId = parameterCabang.cabang_id;

      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        grp,
        subgrp,
        this.tableName,
        String(insertData.tglbukti),
        cabangId,
      );
      insertData.nobukti = nomorBukti;
      insertData.statusformat = formatpenerimaan.formatpenerimaan;
      insertData.postingdari = parameter.memo_nama;
      //INSERT JURNAL UMUM HEADER
      const dataPositif = await trx('parameter')
        .where('text', 'POSITIF')
        .andWhere('grp', 'NILAI PROSES')
        .first();
      const dataNegatif = await trx('parameter')
        .where('text', 'NEGATIF')
        .andWhere('grp', 'NILAI PROSES')
        .first();

      let nobukti_transaksilain = null;
      let penerimaanemklheader_nobukti = null;
      if (data.details.length > 0) {
        // Pisahkan details berdasarkan ada/tidaknya transaksilain_nobukti
        const detailsForPenerimaan = data.details.filter(
          (detail: any) =>
            !detail.transaksilain_nobukti ||
            detail.transaksilain_nobukti.trim() === '',
        );

        const detailsForPengeluaran = data.details.filter(
          (detail: any) =>
            detail.transaksilain_nobukti &&
            detail.transaksilain_nobukti.trim() !== '',
        );

        // ============ PROSES PENERIMAAN (yang ada transaksilain_nobukti) ============
        if (detailsForPenerimaan.length > 0) {
          // Filter hanya detail yang coa-nya ada di coaproses datapengeluaranemkl
          const validDetailsForPenerimaan: any[] = [];

          for (const detail of detailsForPenerimaan) {
            // Cari data pengeluaranemkl berdasarkan coa detail
            const datapenerimaanemkl = await trx('pengeluaranemkl')
              .where('coaproses', detail.coa)
              .first();

            // Hanya proses jika coa ada di coaproses
            if (datapenerimaanemkl) {
              // Validasi nilaiprosespenerimaan
              const statusPenerimaan = datapenerimaanemkl.nilaiprosespenerimaan;
              const nominalValue = parseNumberWithSeparators(detail.nominal);

              // Cek apakah nominal positif atau negatif
              const isPositif = !isNaN(nominalValue) && nominalValue > 0;
              const isNegatif = !isNaN(nominalValue) && nominalValue < 0;
              if (
                isPositif &&
                // Bandingkan sebagai STRING: id parameter NILAI PROSES kini UUID,
                // sehingga Number(dataPositif.id) = NaN dan perbandingan lama
                // (Number !== Number) SELALU true -> create gagal 500 untuk
                // setiap detail yang coa-nya = coaproses EMKL.
                String(statusPenerimaan) !== String(dataPositif.id)
              ) {
                throw new Error(
                  `Error pada detail penerimaan dengan coa ${detail.coa}: Nominal positif harus memiliki nilaiprosespenerimaan 171 (POSITIF), tetapi mendapat ${statusPenerimaan}`,
                );
              }

              if (
                isNegatif &&
                String(statusPenerimaan) !== String(dataNegatif.id)
              ) {
                throw new Error(
                  `Error pada detail penerimaan dengan coa ${detail.coa}: Nominal negatif harus memiliki nilaiprosespenerimaan 172 (NEGATIF), tetapi mendapat ${statusPenerimaan}`,
                );
              }

              // Jika validasi lolos, masukkan ke array valid
              validDetailsForPenerimaan.push(detail);
            }
          }

          // Proses insert hanya jika ada detail yang valid
          if (validDetailsForPenerimaan.length > 0) {
            const detailPenerimaanEmkl = validDetailsForPenerimaan.map(
              (detail: any) => {
                const nominalValue = parseNumberWithSeparators(detail.nominal);
                const absoluteNominal = Math.abs(nominalValue)
                  .toFixed(0)
                  .toString();

                return {
                  id: 0,
                  keterangan: detail.keterangan ?? null,
                  nominal: absoluteNominal ?? null,
                  modifiedby: insertData.modifiedby ?? null,
                  pengeluaranemkl_nobukti: detail.transaksilain_nobukti ?? null,
                };
              },
            );
            const firstValidDetail = validDetailsForPenerimaan[0];
            const datapengeluaranemkl = await trx('pengeluaranemkl')
              .where('coaproses', firstValidDetail.coa)
              .first();

            const payloadPenerimaanEmklHeader = {
              tglbukti: insertData.tglbukti ?? null,
              tgllunas: insertData.tgllunas ?? null,
              keterangan: insertData.keterangan ?? null,
              karyawan_id: data.karyawan_id ?? null,
              format: datapengeluaranemkl.format ?? null,
              coaproses: datapengeluaranemkl.coaproses ?? null,
              jenisposting: data.jenisposting ?? null,
              bank_id: insertData.bank_id ?? null,
              nowarkat: insertData.nowarkat ?? null,
              penerimaan_nobukti: null,
              pengeluaran_nobukti: nomorBukti ?? null,
              created_at: this.utilsService.getTime(),
              updated_at: this.utilsService.getTime(),
              modifiedby: insertData.modifiedby,
              details: detailPenerimaanEmkl,
            };

            const penerimaanemklheaderInserted =
              await this.penerimaanemklheaderService.create(
                payloadPenerimaanEmklHeader,
                trx,
              );
            penerimaanemklheader_nobukti =
              penerimaanemklheaderInserted.newItem.nobukti;
          }
        }

        // ============ PROSES PENGELUARAN (yang tidak ada transaksilain_nobukti) ============
        if (detailsForPengeluaran.length > 0) {
          // Filter hanya detail yang coa-nya ada di coaproses datapengeluaranemkl
          const validDetailsForPengeluaran: any[] = [];

          for (const detail of detailsForPengeluaran) {
            // Cari data pengeluaranemkl berdasarkan coa detail
            const datapenerimaanemkl = await trx('pengeluaranemkl')
              .where('coaproses', detail.coa)
              .first();

            // Hanya proses jika coa ada di coaproses
            if (datapenerimaanemkl) {
              // Validasi nilaiprosespengeluaran
              const statusPengeluaran =
                datapenerimaanemkl.nilaiprosespengeluaran;
              const nominalValue = parseNumberWithSeparators(detail.nominal);

              // Cek apakah nominal positif atau negatif
              const isPositif = !isNaN(nominalValue) && nominalValue > 0;
              const isNegatif = !isNaN(nominalValue) && nominalValue < 0;
              // Validasi: jika positif, status harus 171; jika negatif, status harus 172
              if (
                isPositif &&
                String(statusPengeluaran) !== String(dataPositif.id)
              ) {
                throw new Error(
                  `Error pada detail pengeluaran dengan coa ${detail.coa}: Nominal positif harus memiliki nilaiprosespengeluaran 171 (POSITIF), tetapi mendapat ${statusPengeluaran}`,
                );
              }

              if (
                isNegatif &&
                String(statusPengeluaran) !== String(dataNegatif.id)
              ) {
                throw new Error(
                  `Error pada detail pengeluaran dengan coa ${detail.coa}: Nominal negatif harus memiliki nilaiprosespengeluaran 172 (NEGATIF), tetapi mendapat ${statusPengeluaran}`,
                );
              }

              // Jika validasi lolos, masukkan ke array valid
              validDetailsForPengeluaran.push(detail);
            }
          }

          // Proses insert hanya jika ada detail yang valid
          if (validDetailsForPengeluaran.length > 0) {
            const detailPengeluaranEmkl = validDetailsForPengeluaran.map(
              (detail: any) => {
                const nominalValue = parseNumberWithSeparators(detail.nominal);
                const absoluteNominal = Math.abs(nominalValue)
                  .toFixed(0)
                  .toString();

                return {
                  id: 0,
                  keterangan: detail.keterangan ?? null,
                  nominal: absoluteNominal ?? null,
                  modifiedby: insertData.modifiedby ?? null,
                };
              },
            );

            // Ambil data pengeluaranemkl pertama dari detail yang valid
            const firstValidDetail = validDetailsForPengeluaran[0];
            const datapengeluaranemklForInsert = await trx('pengeluaranemkl')
              .where('coaproses', firstValidDetail.coa)
              .first();
            const payloadPengeluaranEmklHeader = {
              tglbukti: insertData.tglbukti ?? null,
              coaproses: datapengeluaranemklForInsert.coaproses ?? null,
              tgllunas: insertData.tgllunas ?? null,
              keterangan: insertData.keterangan ?? null,
              karyawan_id: data.karyawan_id ?? null,
              jenisposting: data.jenisposting ?? null,
              bank_id: insertData.bank_id ?? null,
              nowarkat: insertData.nowarkat ?? null,
              pengeluaran_nobukti: nomorBukti ?? null,
              created_at: this.utilsService.getTime(),
              updated_at: this.utilsService.getTime(),
              modifiedby: insertData.modifiedby,
              details: detailPengeluaranEmkl,
            };
            const pengeluaranemklheaderInserted =
              await this.pengeluaranemklheaderService.create(
                payloadPengeluaranEmklHeader,
                trx,
              );
            nobukti_transaksilain =
              pengeluaranemklheaderInserted.newItem.nobukti;
          }
        }
      }

      const processDetails = (details) => {
        // Proses setiap detail dan langsung buat pasangannya
        return details.flatMap((detail) => [
          // Debet
          {
            id: 0,
            coa: formatpenerimaan.coa,
            nobukti: nomorBukti,
            tglbukti: formatDateToSQL(insertData.tglbukti),
            keterangan: detail.keterangan,
            nominaldebet: detail.nominal,
            nominalkredit: '',
          },
          // Kredit (langsung dipasangkan)
          {
            id: 0,
            coa: detail.coa,
            nobukti: nomorBukti,
            tglbukti: formatDateToSQL(insertData.tglbukti),
            keterangan: detail.keterangan,
            nominaldebet: '',
            nominalkredit: detail.nominal,
          },
        ]);
      };
      const result = processDetails(data.details);
      const dataJurnalumum = {
        nobukti: nomorBukti,
        tglbukti: formatDateToSQL(insertData.tglbukti),
        keterangan: insertData.keterangan,
        postingdari: parameter.memo_nama,
        statusformat: formatpenerimaan.formatpenerimaan,
        modifiedby: insertData.modifiedby,
        details: result,
      };
      await this.jurnalumumheaderService.create(dataJurnalumum, trx);
      //c
      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

      if (data.details.length > 0) {
        // Inject nobukti into each detail item
        const detailsWithNobukti = data.details.map((detail: any) => ({
          ...detail,
          nobukti: nomorBukti, // Inject nobukti into each detail
          pengembaliankasgantung_nobukti: detail.pengembaliankasgantung_nobukti,
          modifiedby: insertData.modifiedby,
        }));

        // Pass the updated details with nobukti to the detail creation service
        await this.penerimaandetailService.create(
          detailsWithNobukti,
          insertedItems[0].id,
          trx,
        );
      }

      const newItem = insertedItems[0];

      const { data: filteredItems } = await this.findAll(
        {
          search: data.search,
          filters: data.filters,
          pagination: { page: data.page, limit: 0 },
          sort: { sortBy: data.sortBy, sortDirection: data.sortDirection },
          isLookUp: false, // Set based on your requirement (e.g., lookup flag)
        },
        trx,
      );
      const dataDetail = await this.penerimaandetailService.findAll(
        {
          filters: {
            nobukti: newItem.nobukti,
          },
        },
        trx,
      );

      // Cari index item baru di hasil yang sudah difilter
      let itemIndex = filteredItems.findIndex(
        (item) => String(item.id) === String(newItem.id),
      );

      if (itemIndex === -1) {
        itemIndex = 0;
      }

      const pageNumber = Math.floor(itemIndex / data.limit) + 1;
      const endIndex = pageNumber * data.limit;

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
          postingdari: `ADD PENERIMAAN HEADER`,
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
        t.string('nobukti').nullable();
        t.text('link').nullable();
      });
      const url = 'jurnalumumheader';

      await trx(tempUrl).insert(
        trx
          .select(
            'u.id',
            'u.nobukti',
            trx.raw(`
              STRING_AGG(
                '<a target="_blank" className="link-color" href="/dashboard/${url}' + ${tandatanya} + 'nobukti=' + u.nobukti + '">' +
                '<HighlightWrapper value="' + u.nobukti + '" />' +
                '</a>', ','
              ) AS link
            `),
          )
          .from(this.tableName + ' as u')
          .groupBy('u.id', 'u.nobukti'),
      );
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.relasi_id',
          'u.keterangan',
          'u.bank_id',
          'u.postingdari',
          'u.coakasmasuk',
          'u.diterimadari',
          'u.alatbayar_id',
          'u.nowarkat',
          trx.raw("TO_CHAR(u.tgllunas, 'DD-MM-YYYY') as tgllunas"),
          'u.noresi',
          'u.statusformat',
          'u.info',
          'u.modifiedby',
          'ap.keterangancoa as coakasmasuk_nama',
          'r.nama as relasi_nama',
          'b.nama as bank_nama',
          'ab.nama as alatbayar_nama',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'tempUrl.link',
        ])
        .leftJoin('akunpusat as ap', 'u.coakasmasuk', 'ap.coa')
        .innerJoin(
          trx.raw(`${tempUrl} as tempUrl`),
          'u.nobukti',
          'tempUrl.nobukti',
        )
        .leftJoin('relasi as r', 'u.relasi_id', 'r.id')
        .leftJoin('bank as b', 'u.bank_id', 'b.id')
        .leftJoin('alatbayar as ab', 'u.alatbayar_id', 'ab.id');

      // Filter tanggal jika ada
      if (filters?.tglDari && filters?.tglSampai) {
        const tglDariFormatted = formatDateToSQL(String(filters?.tglDari));
        const tglSampaiFormatted = formatDateToSQL(String(filters?.tglSampai));
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

      // Field yang bisa dicari
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

      // Filtering berdasarkan kolom tabel
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');
          if (value) {
            if (key === 'tglDari' || key === 'tglSampai') continue;
            if (value) {
              if (
                key === 'created_at' ||
                key === 'updated_at' ||
                key === 'tgllunas' ||
                key === 'tglbukti'
              ) {
                query.andWhereRaw(
                  "TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?",
                  [key, `%${sanitizedValue}%`],
                );
              } else if (key === 'relasi_nama') {
                query.andWhere(`r.nama`, 'like', `%${sanitizedValue}%`);
              } else if (key === 'bank_nama') {
                query.andWhere(`b.nama`, 'like', `%${sanitizedValue}%`);
              } else if (key === 'alatbayar_nama') {
                query.andWhere(`ab.nama`, 'like', `%${sanitizedValue}%`);
              } else {
                query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
              }
            }
          }
        }
      }

      const result = await trx(this.tableName).count('id as total').first();
      const total = result?.total as number;
      const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

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
        relasi_nama,
        bank_nama,
        alatbayar_nama,
        coakasmasuk_nama,
        daftarbank_nama,
        coakredit_nama,
        penerimaan_nobukti,
        details,
        ...insertData
      } = data;

      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      [
        'nobukti',
        'keterangan',
        'postingdari',
        'diterimadari',
        'nowarkat',
        'noresi',
      ].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });
      const formatpenerimaan = await trx(`bank as b`)
        .select('p.grp', 'p.subgrp', 'b.formatpenerimaan', 'b.coa')
        .leftJoin('parameter as p', 'p.id', 'b.formatpenerimaan')
        .where('b.id', insertData.bank_id)
        .first();
      const existingData = await trx(this.tableName).where('id', id).first();
      const hasChanges = this.utilsService.hasChanges(insertData, existingData);
      const jurnalUmumData = await trx('jurnalumumheader')
        .where('nobukti', existingData.nobukti)
        .first();
      console.log(jurnalUmumData, 'jurnalUmumData');
      console.log(existingData, 'existingData');
      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();

        await trx(this.tableName).where('id', id).update(insertData);
      }
      if (details.length >= 0) {
        const detailsWithNobukti = details.map((detail: any) => {
          // Destructure to exclude 'penerimaandetail_id' when penerimaan_nobukti exists
          const { penerimaandetail_id, ...rest } = detail;

          const updatedDetail = {
            ...rest,
            nobukti: existingData.nobukti, // Inject nobukti into each detail
            modifiedby: insertData.modifiedby,
          };

          // If penerimaan_nobukti exists, add 'id' based on penerimaandetail_id
          if (penerimaan_nobukti) {
            updatedDetail.id = penerimaandetail_id;
          }

          return updatedDetail;
        });

        // Call the service to create or update details
        await this.penerimaandetailService.create(detailsWithNobukti, id, trx);
      }

      const processDetails = (details) => {
        // Proses setiap detail dan langsung buat pasangannya
        return details.flatMap((detail) => [
          // Debet
          {
            id: 0,
            coa: formatpenerimaan.coa,
            nobukti: existingData.nobukti,
            tglbukti: formatDateToSQL(insertData.tglbukti),
            keterangan: detail.keterangan,
            nominaldebet: detail.nominal,
            nominalkredit: '',
          },
          // Kredit (langsung dipasangkan)
          {
            id: 0,
            coa: detail.coa,
            nobukti: existingData.nobukti,
            tglbukti: formatDateToSQL(insertData.tglbukti),
            keterangan: detail.keterangan,
            nominaldebet: '',
            nominalkredit: detail.nominal,
          },
        ]);
      };
      const result = processDetails(details);
      const requestJurnalUmum = {
        tglbukti: formatDateToSQL(insertData.tglbukti),
        keterangan: insertData.keterangan,
        modifiedby: data.modifiedby,
        details: result,
      };

      const updatedJurnalUmum = await this.jurnalumumheaderService.update(
        jurnalUmumData.id,
        requestJurnalUmum,
        trx,
      );
      // Check each detail, update or set id accordingly

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
      console.log(filteredItems, 'filteredItems');
      // Cari index item baru di hasil yang sudah difilter
      let itemIndex = filteredItems.findIndex(
        (item) => String(item.id) === String(id),
      );
      console.log(itemIndex, 'itemIndex');
      console.log(id, 'id');
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
          postingdari: `EDIT PENERIMAAN HEADER`,
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
      console.error('Error updating data:', error);
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
        'penerimaandetail',
        'penerimaan_id',
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE PENERIMAAN DETAIL',
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
  async findOne(id: string, trx: any) {
    try {
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.relasi_id',
          'u.keterangan',
          'u.bank_id',
          'u.postingdari',
          'u.coakasmasuk',
          'u.diterimadari',
          'u.alatbayar_id',
          'u.nowarkat',
          trx.raw("TO_CHAR(u.tgllunas, 'DD-MM-YYYY') as tgllunas"),
          'u.noresi',
          'u.statusformat',
          'u.info',
          'u.modifiedby',
          'r.nama as relasi_nama',
          'b.nama as bank_nama',
          'ab.nama as alatbayar_nama',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
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

  async exportToExcel(data: any[], trx: any) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    // Header laporan
    worksheet.mergeCells('A1:E1');
    worksheet.mergeCells('A2:E2');
    worksheet.mergeCells('A3:E3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN PENERIMAAN';
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
      const detailRes = await this.penerimaandetailService.findAll(
        {
          filters: {
            nobukti: h.nobukti,
          },
        },
        trx,
      );
      const details = detailRes?.data ?? [];

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
      `laporan_penerimaan${Date.now()}.xlsx`,
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
