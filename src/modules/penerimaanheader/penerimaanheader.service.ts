import {
  BadRequestException,
  Injectable,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  withUuidV7,
  formatDateToSQL,
  parseNumberWithSeparators,
  calculateItemIndex,
  getFetchedPages,
  UtilsService,
} from 'src/utils/utils.service';
import { numberToTerbilang } from 'src/utils/terbilang';
import { RedisService } from 'src/common/redis/redis.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { PenerimaandetailService } from '../penerimaandetail/penerimaandetail.service';
import { LocksService } from '../locks/locks.service';
import { GlobalService } from '../global/global.service';
import {
  FindAllParams,
  WriteOptions,
} from 'src/common/interfaces/all.interface';
import { Column, Workbook } from 'exceljs';
import {
  EXCEL_FORMAT,
  ExportSheetDefinition,
} from 'src/common/report/export-job.service';
import * as fs from 'fs';
import * as path from 'path';
import { JurnalumumheaderService } from '../jurnalumumheader/jurnalumumheader.service';
import { PenerimaanemklheaderService } from '../penerimaanemklheader/penerimaanemklheader.service';
import { PengeluaranemklheaderService } from '../pengeluaranemklheader/pengeluaranemklheader.service';

@Injectable()
export class PenerimaanheaderService implements OnModuleInit {
  private penerimaanemklheaderService: PenerimaanemklheaderService;
  private pengeluaranemklheaderService: PengeluaranemklheaderService;

  constructor(
    // Wrapper RedisService (BUKAN raw 'REDIS_CLIENT'): set/get/del jadi
    // best-effort sehingga create/update tidak gagal 500 "Stream isn't
    // writeable" saat Redis mati — sama seperti pengeluaranheader.
    private readonly redisService: RedisService,
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
  private readonly viewName = 'vpenerimaanheader';

  /**
   * Periode dan bank diturunkan ke vpenerimaanheader lewat GUC
   * (`tas.tgldari`, `tas.tglsampai`, `tas.bank_id`), bukan sebagai predikat di
   * query luar: view menyaring penerimaanheader SEBELUM LEFT JOIN
   * relasi/bank/akunpusat/alatbayar.
   *
   * `set_config(..., true)` hanya hidup selama transaksi — jalur tanpa trx
   * (export background) wajib memakai applyPeriodFilters.
   */
  private async setDateRangeSessionContext(
    trx: any,
    filters: Record<string, any>,
  ): Promise<void> {
    const tglDari = filters?.tglDari
      ? formatDateToSQL(String(filters.tglDari))
      : null;
    const tglSampai = filters?.tglSampai
      ? formatDateToSQL(String(filters.tglSampai))
      : null;

    // Nilai kosong dikirim EKSPLISIT karena GUC-nya memakai nama global:
    // service lain (jurnal umum, pengeluaran) sudah men-set tas.tgldari di
    // transaksi yang sama, dan sisanya akan ikut memangkas penerimaan kalau
    // tidak ditimpa.
    await trx.raw(
      `SELECT set_config('tas.tgldari', ?, true),
              set_config('tas.tglsampai', ?, true),
              set_config('tas.bank_id', ?, true)`,
      [
        tglDari ?? '',
        tglSampai ?? '',
        filters?.bank_id ? String(filters.bank_id) : '',
      ],
    );
  }

  /**
   * Search global + filter per kolom. Periode/bank TIDAK di sini — keduanya
   * urusan setDateRangeSessionContext (jalur transaksi) atau applyPeriodFilters
   * (export).
   */
  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
    alias = 'u',
  ): void {
    const excludeSearchKeys = ['tglDari', 'tglSampai', 'bank_id'];
    const dateFields = ['created_at', 'updated_at', 'tglbukti', 'tgllunas'];

    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );

    if (search && searchFields.length > 0) {
      const sanitizedValue = String(search).replace(/\[/g, '[[]').trim();
      qb.where((query: any) => {
        searchFields.forEach((field) => {
          if (dateFields.includes(field)) {
            query.orWhereRaw(
              `TO_CHAR(${alias}.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?`,
              [field, `%${sanitizedValue}%`],
            );
          } else {
            query.orWhere(`${alias}.${field}`, 'ilike', `%${sanitizedValue}%`);
          }
        });
      });
    }

    Object.entries(filters || {}).forEach(([key, rawValue]) => {
      if (excludeSearchKeys.includes(key)) return;
      if (rawValue === null || rawValue === undefined || rawValue === '')
        return;

      const sanitizedValue = String(rawValue).replace(/\[/g, '[[]');
      if (dateFields.includes(key)) {
        qb.andWhereRaw(
          `TO_CHAR(${alias}.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?`,
          [key, `%${sanitizedValue}%`],
        );
      } else {
        qb.andWhere(`${alias}.${key}`, 'ilike', `%${sanitizedValue}%`);
      }
    });
  }

  /**
   * Format penerimaan diambil dari BANK-nya, jadi bank wajib terisi dan
   * banknya wajib punya `formatpenerimaan`.
   *
   * Sebelumnya hasil query ini dipakai langsung (`formatpenerimaan.grp`), jadi
   * bank kosong / tidak ketemu berujung "Cannot read properties of undefined
   * (reading 'formatpenerimaan')" — 500 yang tidak memberi tahu apa pun ke user.
   */
  private async resolveFormatPenerimaan(trx: any, bankId: any) {
    if (!bankId || String(bankId).trim() === '') {
      throw new BadRequestException('BANK WAJIB DIISI');
    }

    const formatpenerimaan = await trx('bank as b')
      .select('p.grp', 'p.subgrp', 'b.formatpenerimaan', 'b.coa', 'b.nama')
      .leftJoin('parameter as p', 'p.id', 'b.formatpenerimaan')
      .where('b.id', bankId)
      .first();

    if (!formatpenerimaan) {
      throw new BadRequestException('BANK YANG DIPILIH TIDAK DITEMUKAN');
    }
    if (!formatpenerimaan.formatpenerimaan) {
      throw new BadRequestException(
        `BANK ${formatpenerimaan.nama ?? ''} BELUM DIATUR FORMAT PENERIMAANNYA`.trim(),
      );
    }
    if (!formatpenerimaan.coa) {
      throw new BadRequestException(
        `BANK ${formatpenerimaan.nama ?? ''} BELUM MEMILIKI COA`.trim(),
      );
    }

    return formatpenerimaan;
  }

  async create(data: any, trx: any, options: WriteOptions = {}) {
    const { withGridPosition = true } = options;
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

      const formatpenerimaan = await this.resolveFormatPenerimaan(
        trx,
        insertData.bank_id,
      );
      const parameter = await trx('parameter')
        .select(
          'grp',
          'subgrp',
          trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
        )
        .where('id', formatpenerimaan.formatpenerimaan)
        .first();

      if (!parameter) {
        throw new BadRequestException(
          'PARAMETER FORMAT PENERIMAAN UNTUK BANK INI TIDAK DITEMUKAN',
        );
      }
      if (!parameterCabang?.cabang_id) {
        throw new BadRequestException('PARAMETER CABANG BELUM DIATUR');
      }

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
                  id: '0',
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
                  id: '0',
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
            id: '0',
            coa: formatpenerimaan.coa,
            nobukti: nomorBukti,
            tglbukti: formatDateToSQL(insertData.tglbukti),
            keterangan: detail.keterangan,
            nominaldebet: detail.nominal,
            nominalkredit: '',
          },
          // Kredit (langsung dipasangkan)
          {
            id: '0',
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
      await this.jurnalumumheaderService.create(dataJurnalumum, trx, {
        withGridPosition: false,
      });
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

      const dataDetail = await this.penerimaandetailService.findAll(
        { filters: { nobukti: newItem.nobukti } },
        trx,
      );

      // ============ GET POSITION ============
      // Posisi/pagination hanya dipakai grid penerimaan untuk memfokuskan baris
      // baru. Pemanggilan bersarang mematikannya lewat withGridPosition. Tetap
      // dibungkus try/catch: header + detail + jurnal sudah tersimpan, jadi
      // gagal menghitung posisi tidak boleh me-rollback simpan yang berhasil.
      const { sortBy, sortDirection, filters, search } = data;
      const limit = Number(data.limit) > 0 ? Number(data.limit) : 10;
      const sortColumn = sortBy || 'nobukti';
      const sortDir =
        String(sortDirection).toLowerCase() === 'desc' ? 'desc' : 'asc';

      let pageNumber = 1;
      let fetchedPages: number[] = [1];
      const pagedData: Record<number, any> = {};
      let allFetchedData: any[] = [];
      let itemIndex: any = { zeroBasedIndex: 0 };

      if (withGridPosition) {
        try {
          await this.setDateRangeSessionContext(trx, filters || {});

          // Nilai pembanding diambil dari VIEW, bukan dari insertData: sortBy
          // bisa menunjuk kolom turunan (relasi_text/bank_text/...) yang tidak
          // ada di payload insert, dan insertData[sortBy] yang undefined
          // membuat perbandingannya selalu gagal.
          const existingData = await trx(`${this.viewName} as u`)
            .where('u.id', newItem.id)
            .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
            .first();

          const totalRecords = await trx(`${this.viewName} as u`)
            .count('u.id as total')
            .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
            .first();
          const totalItems = Number(totalRecords?.total ?? 0);

          let posisi = 1;
          if (existingData) {
            const resultposition = await trx(`${this.viewName} as u`)
              .count('* as posisi')
              .where((qb: any) => {
                qb.where(
                  `u.${sortColumn}`,
                  sortDir === 'desc' ? '>' : '<',
                  existingData[sortColumn],
                ).orWhere((q: any) =>
                  q
                    .where(`u.${sortColumn}`, existingData[sortColumn])
                    .andWhere('u.id', '<=', newItem.id),
                );
              })
              .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
              .first();
            posisi = Number(resultposition?.posisi ?? 0) || 1;
          }

          pageNumber = Math.ceil(posisi / limit);
          const totalPages = Math.ceil(totalItems / limit);
          fetchedPages = getFetchedPages(pageNumber, totalPages);

          const startPage = fetchedPages[0];
          const endPage = fetchedPages[fetchedPages.length - 1];
          const customOffset = (startPage - 1) * limit;
          const totalDataNeeded = (endPage - startPage + 1) * limit;

          const findAllResult = await this.findAll(
            {
              search: search || '',
              filters: filters || {},
              pagination: {
                page: startPage,
                limit: totalDataNeeded,
                customOffset,
              },
              sort: { sortBy: sortColumn, sortDirection: sortDir },
              isLookUp: false,
              useCustomOffset: true,
            },
            trx,
          );

          allFetchedData = findAllResult?.data ?? [];
          let dataIndex = 0;
          fetchedPages.forEach((pageNum) => {
            pagedData[pageNum] = allFetchedData.slice(
              dataIndex,
              dataIndex + limit,
            );
            dataIndex += limit;
          });

          itemIndex = calculateItemIndex(Number(posisi), fetchedPages, limit);
        } catch (posErr: any) {
          console.warn(
            'penerimaanheader: komputasi posisi pasca-simpan gagal (non-fatal):',
            posErr?.message,
          );
        }
      }
      // ============ END GET POSITION ============

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD PENERIMAAN HEADER`,
          idtrans: newItem.id,
          nobuktitrans: newItem.nobukti,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      // Hanya tulis cache saat window-nya benar-benar dihitung; tanpa guard ini
      // pemanggilan bersarang menimpa page-1 dengan array kosong.
      if (withGridPosition) {
        await this.redisService.set(
          `${this.tableName}-page-${pageNumber}`,
          JSON.stringify(allFetchedData),
        );
      }

      return {
        newItem,
        itemIndex: itemIndex.zeroBasedIndex < 0 ? 0 : itemIndex.zeroBasedIndex,
        pageNumber,
        fetchedPages,
        pagedData,
        dataDetail,
      };
    } catch (error) {
      // HttpException diteruskan apa adanya; dibungkus `new Error(...)` di sini,
      // statusCode + pesan validasinya hilang dan controller cuma menerima
      // Error biasa sehingga user selalu dapat 500 generik.
      if (error instanceof HttpException) {
        throw error;
      }
      throw new Error(`Error: ${error.message}`);
    }
  }

  async findAll(
    {
      search,
      filters,
      pagination,
      sort,
      isLookUp,
      useCustomOffset,
    }: FindAllParams,
    trx: any,
  ) {
    try {
      const { page = 1, customOffset } = pagination ?? {};
      let limit = pagination?.limit ?? 0;
      const safeFilters = filters || {};

      const sortBy = sort?.sortBy || 'nobukti';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';

      await this.setDateRangeSessionContext(trx, safeFilters);

      // Total dihitung DENGAN filter yang sama seperti datanya; sebelumnya
      // COUNT jalan tanpa filter (dan dari tabel base) sehingga totalPages grid
      // selalu memakai jumlah seluruh tabel.
      const countResult = await trx(`${this.viewName} as u`)
        .count('u.id as total')
        .modify((qb: any) => this.applyFilters(qb, safeFilters, search))
        .first();
      const total = Number(countResult?.total ?? 0);

      if (isLookUp) {
        if (total > 500) {
          return {
            data: [],
            type: 'json',
            total,
            pagination: {
              currentPage: 1,
              totalPages: 0,
              totalItems: total,
              itemsPerPage: 0,
            },
          };
        }
        limit = 0;
      }

      const query = trx(`${this.viewName} as u`)
        .select([
          'u.id',
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
          trx.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
          'u.relasi_text',
          'u.bank_text',
          'u.coakasmasuk_text',
          'u.alatbayar_text',
          'u.link',
        ])
        .modify((qb: any) => this.applyFilters(qb, safeFilters, search));

      // Urutan HARUS deterministik: tanpa tiebreaker, offset/limit bisa
      // memulangkan baris yang sama di dua halaman berbeda saat grid menggeser
      // window.
      query.orderBy(`u.${sortBy}`, sortDirection);
      if (sortBy !== 'id') {
        query.orderBy('u.id', 'asc');
      }

      // buildPagedResult mengambil BEBERAPA halaman sekaligus (limit =
      // totalDataNeeded) tapi offsetnya harus tetap dihitung per ukuran
      // halaman. Tanpa cabang customOffset, offset jadi
      // (startPage-1)*totalDataNeeded — melewati akhir data begitu startPage > 1.
      const offset =
        useCustomOffset === true && customOffset !== undefined
          ? customOffset
          : (page - 1) * limit;

      if (limit > 0) {
        query.offset(offset).limit(limit);
      }

      const data = await query;
      const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
      const responseType = total > 500 ? 'json' : 'local';

      return {
        data,
        type: responseType,
        total,
        pagination: {
          currentPage: Number(page),
          totalPages,
          totalItems: total,
          itemsPerPage: limit,
        },
      };
    } catch (error) {
      console.error('Error to findAll Penerimaan Header', error);
      throw new Error('Failed to fetch data');
    }
  }

  async update(id: any, data: any, trx: any, options: WriteOptions = {}) {
    const { withGridPosition = true } = options;
    try {
      data.tglbukti = formatDateToSQL(String(data?.tglbukti)); // Fungsi untuk format

      // Kolom tampilan ikut dibuang di sini: grid sekarang mengirim `<x>_text`
      // (kolom view), sementara payload lama memakai `<x>_nama`. Keduanya
      // didestrukturisasi supaya form versi lama pun tidak menyelipkan kolom
      // yang tidak ada di tabel ke dalam UPDATE. `isreload` juga: grid
      // menyebar state filter ke body simpan, dan itu bukan kolom tabel.
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        isreload,
        relasi_nama,
        bank_nama,
        alatbayar_nama,
        coakasmasuk_nama,
        daftarbank_nama,
        coakredit_nama,
        relasi_text,
        bank_text,
        alatbayar_text,
        coakasmasuk_text,
        link,
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
      const formatpenerimaan = await this.resolveFormatPenerimaan(
        trx,
        insertData.bank_id,
      );
      const existingData = await trx(this.tableName).where('id', id).first();
      if (!existingData) {
        throw new HttpException(
          { statusCode: 400, message: 'Data Not Found!' },
          400,
        );
      }
      const hasChanges = this.utilsService.hasChanges(insertData, existingData);
      const jurnalUmumData = await trx('jurnalumumheader')
        .where('nobukti', existingData.nobukti)
        .first();
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
            id: '0',
            coa: formatpenerimaan.coa,
            nobukti: existingData.nobukti,
            tglbukti: formatDateToSQL(insertData.tglbukti),
            keterangan: detail.keterangan,
            nominaldebet: detail.nominal,
            nominalkredit: '',
          },
          // Kredit (langsung dipasangkan)
          {
            id: '0',
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

      // Jurnalnya boleh belum ada (bukti lama yang dibuat sebelum posting
      // jurnal otomatis); tanpa guard ini update-nya melempar "Cannot read
      // properties of undefined (reading 'id')".
      if (jurnalUmumData) {
        await this.jurnalumumheaderService.update(
          jurnalUmumData.id,
          requestJurnalUmum,
          trx,
          { withGridPosition: false },
        );
      } else {
        await this.jurnalumumheaderService.create(
          {
            ...requestJurnalUmum,
            nobukti: existingData.nobukti,
            postingdari: existingData.postingdari,
            statusformat: existingData.statusformat,
          },
          trx,
          { withGridPosition: false },
        );
      }

      // ============ GET POSITION ============
      const pageLimit = Number(limit) > 0 ? Number(limit) : 10;
      const sortColumn = sortBy || 'nobukti';
      const sortDir =
        String(sortDirection).toLowerCase() === 'desc' ? 'desc' : 'asc';

      let pageNumber = 1;
      let fetchedPages: number[] = [1];
      const pagedData: Record<number, any> = {};
      let allFetchedData: any[] = [];
      let itemIndex: any = { zeroBasedIndex: 0 };

      if (withGridPosition) {
        try {
          await this.setDateRangeSessionContext(trx, filters || {});

          const positionRow = await trx(`${this.viewName} as u`)
            .where('u.id', id)
            .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
            .first();

          const totalRecords = await trx(`${this.viewName} as u`)
            .count('u.id as total')
            .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
            .first();
          const totalItems = Number(totalRecords?.total ?? 0);

          let posisi = 1;
          if (positionRow) {
            const resultposition = await trx(`${this.viewName} as u`)
              .count('* as posisi')
              .where((qb: any) => {
                qb.where(
                  `u.${sortColumn}`,
                  sortDir === 'desc' ? '>' : '<',
                  positionRow[sortColumn],
                ).orWhere((q: any) =>
                  q
                    .where(`u.${sortColumn}`, positionRow[sortColumn])
                    .andWhere('u.id', '<=', id),
                );
              })
              .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
              .first();
            posisi = Number(resultposition?.posisi ?? 0) || 1;
          }

          pageNumber = Math.ceil(posisi / pageLimit);
          const totalPages = Math.ceil(totalItems / pageLimit);
          fetchedPages = getFetchedPages(pageNumber, totalPages);

          const startPage = fetchedPages[0];
          const endPage = fetchedPages[fetchedPages.length - 1];
          const customOffset = (startPage - 1) * pageLimit;
          const totalDataNeeded = (endPage - startPage + 1) * pageLimit;

          const result = await this.findAll(
            {
              search: search || '',
              filters: filters || {},
              pagination: {
                page: startPage,
                limit: totalDataNeeded,
                customOffset,
              },
              sort: { sortBy: sortColumn, sortDirection: sortDir },
              isLookUp: false,
              useCustomOffset: true,
            },
            trx,
          );

          allFetchedData = result?.data ?? [];
          let dataIndex = 0;
          fetchedPages.forEach((pageNum) => {
            pagedData[pageNum] = allFetchedData.slice(
              dataIndex,
              dataIndex + pageLimit,
            );
            dataIndex += pageLimit;
          });

          itemIndex = calculateItemIndex(
            Number(posisi),
            fetchedPages,
            pageLimit,
          );
        } catch (posErr: any) {
          console.warn(
            'penerimaanheader: komputasi posisi pasca-simpan gagal (non-fatal):',
            posErr?.message,
          );
        }
      }
      // ============ END GET POSITION ============

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `EDIT PENERIMAAN HEADER`,
          idtrans: id,
          nobuktitrans: existingData.nobukti,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      if (withGridPosition) {
        await this.redisService.set(
          `${this.tableName}-page-${pageNumber}`,
          JSON.stringify(allFetchedData),
        );
      }

      return {
        updatedItem: {
          id,
          ...data,
        },
        itemIndex: itemIndex.zeroBasedIndex < 0 ? 0 : itemIndex.zeroBasedIndex,
        pageNumber,
        fetchedPages,
        pagedData,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
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
          postingdari: 'DELETE PENERIMAAN HEADER',
          idtrans: id,
          nobuktitrans: deletedData.nobukti,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby,
        },
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: 'penerimaandetail',
          postingdari: 'DELETE PENERIMAAN DETAIL',
          idtrans: id,
          nobuktitrans: deletedData.nobukti,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedDataDetail),
          modifiedby: modifiedby,
        },
        trx,
      );

      // Jurnalnya ikut dihapus: nobukti penerimaan adalah kunci jurnal umumnya,
      // dan tanpa ini jurnal jadi yatim lalu ikut terhitung di laporan.
      const jurnal = await trx('jurnalumumheader')
        .where('nobukti', deletedData.nobukti)
        .first();
      if (jurnal) {
        await this.jurnalumumheaderService.delete(jurnal.id, trx, modifiedby);
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
          trx.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
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

  /**
   * Data untuk LaporanPenerimaan.mrt: `data` (satu baris header + kolom
   * tambahan judul/usercetak/tglcetak/terbilang) dan `detail` (rincian coa).
   *
   * `db` boleh berupa instance knex tanpa transaksi: ini murni pembacaan dan
   * job-nya berumur panjang, jadi tidak ada gunanya menahan koneksi. findOne
   * membaca tabel base + JOIN sendiri (bukan vpenerimaanheader), sehingga tidak
   * bergantung pada GUC periode yang hanya hidup di dalam transaksi.
   */
  async loadReportData(
    id: string,
    { username, judullaporan }: { username: string; judullaporan?: string },
    db: any,
  ): Promise<Record<string, any[]>> {
    const { data: headerRows } = await this.findOne(id, db);

    if (!headerRows?.length) {
      return { data: [], detail: [] };
    }

    const header = headerRows[0];

    const detailRes = await this.penerimaandetailService.findAll(
      { filters: { nobukti: header.nobukti } },
      db,
    );
    const details = detailRes.data ?? [];

    // Dijumlahkan dalam satuan sen lalu dibagi 100: menjumlah float rupiah
    // langsung meninggalkan sisa pembulatan yang membuat "terbilang" meleset
    // satu rupiah.
    const totalNominal =
      details.reduce(
        (sum: number, item: any) =>
          sum + Math.round((Number(item.nominal) || 0) * 100),
        0,
      ) / 100;

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const tglcetak =
      `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ` +
      `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    return {
      data: [
        {
          ...header,
          judullaporan: judullaporan ?? 'Laporan Penerimaan',
          usercetak: username,
          tglcetak,
          terbilang: numberToTerbilang(totalNominal),
          judul: 'Bukti Penerimaan KAS EMKL',
        },
      ],
      detail: details,
    };
  }

  /**
   * Data master satu bukti untuk blok info di atas tabel rincian. Dipakai juga
   * untuk memberi nama file, jadi diambil SEBELUM job export dimulai supaya id
   * yang tidak ada langsung balas 404, bukan gagal di tengah job.
   *
   * Membaca tabel base + JOIN sendiri (bukan vpenerimaanheader) supaya tidak
   * bergantung pada GUC periode yang hanya hidup di dalam transaksi — export
   * berjalan tanpa transaksi.
   */
  async loadExportBuktiHeader(id: string, db: any) {
    const header = await db(`${this.tableName} as u`)
      .select([
        'u.nobukti',
        db.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
        'u.keterangan',
        'u.postingdari',
        'u.diterimadari',
        'u.noresi',
        'r.nama as relasi_text',
        'b.nama as bank_text',
        'ap.keterangancoa as coakasmasuk_text',
      ])
      .leftJoin('relasi as r', 'u.relasi_id', 'r.id')
      .leftJoin('bank as b', 'u.bank_id', 'b.id')
      .leftJoin('akunpusat as ap', 'u.coakasmasuk', 'ap.coa')
      .where('u.id', String(id))
      .first();

    if (!header) {
      throw new NotFoundException(`Penerimaan dengan id ${id} tidak ditemukan`);
    }

    return header;
  }

  /**
   * Rincian satu bukti, urut sesuai urutan input. Dikembalikan sebagai query
   * (bukan array) supaya ExportJobService bisa men-stream-nya lewat cursor.
   */
  buildExportBuktiQuery(nobukti: string, db: any) {
    return db('vpenerimaandetail as d')
      .select(['d.nobukti', 'd.keterangan', 'd.coa', 'd.coa_text', 'd.nominal'])
      .where('d.nobukti', nobukti)
      .orderBy('d.created_at', 'asc')
      .orderBy('d.id', 'asc');
  }

  /** Jumlah baris rincian — dipakai untuk progres export yang nyata. */
  async countExportBuktiRows(nobukti: string, db: any): Promise<number> {
    const result = await db('vpenerimaandetail as d')
      .count('d.id as total')
      .where('d.nobukti', nobukti)
      .first();

    return Number(result?.total ?? 0);
  }

  /** Sheet export per transaksi: blok master di atas, rincian + TOTAL di bawah. */
  buildExportBuktiSheet(header: any): ExportSheetDefinition {
    return {
      sheetName: 'Penerimaan',
      titleLines: [
        'PT. TRANSPORINDO AGUNG SEJAHTERA',
        'LAPORAN PENERIMAAN',
        String(header.nobukti ?? ''),
      ],
      infoLines: [
        { label: 'NO BUKTI', value: header.nobukti },
        { label: 'TGL BUKTI', value: header.tglbukti },
        { label: 'BANK / KAS', value: header.bank_text },
        { label: 'COA KAS MASUK', value: header.coakasmasuk_text },
        { label: 'RELASI', value: header.relasi_text },
        { label: 'DITERIMA DARI', value: header.diterimadari },
        { label: 'NO RESI', value: header.noresi },
        { label: 'KETERANGAN', value: header.keterangan },
      ],
      headers: ['NO.', 'NO BUKTI', 'KETERANGAN', 'COA', 'NOMINAL'],
      columnFormats: [
        null,
        null,
        null,
        null,
        { numFmt: EXCEL_FORMAT.RUPIAH_DESIMAL },
      ],
      totalRow: { sumColumns: [4] },
      mapRow: (row: any, rowNumber: number) => [
        rowNumber,
        row.nobukti,
        row.keterangan,
        row.coa_text,
        row.nominal,
      ],
    };
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
