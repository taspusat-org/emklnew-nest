import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CreatePengeluaranheaderDto } from './dto/create-pengeluaranheader.dto';
import { UpdatePengeluaranheaderDto } from './dto/update-pengeluaranheader.dto';
import {
  FindAllParams,
  WriteOptions,
} from 'src/common/interfaces/all.interface';
import { RedisService } from 'src/common/redis/redis.service';
import {
  withUuidV7,
  formatDateToSQL,
  UtilsService,
  tandatanya,
  formatIndonesianNumber,
  parseNumberWithSeparators,
  formatIndonesianNegative,
  calculateItemIndex,
  getFetchedPages,
} from 'src/utils/utils.service';
import { numberToTerbilang } from 'src/utils/terbilang';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { PengeluarandetailService } from '../pengeluarandetail/pengeluarandetail.service';
import { JurnalumumheaderService } from '../jurnalumumheader/jurnalumumheader.service';
import { GlobalService } from '../global/global.service';
import { LocksService } from '../locks/locks.service';
import * as fs from 'fs';
import * as path from 'path';
import { Workbook, Column } from 'exceljs';
import { StatuspendukungService } from '../statuspendukung/statuspendukung.service';
import { PengeluaranemklheaderService } from '../pengeluaranemklheader/pengeluaranemklheader.service';
import { PenerimaanemklheaderService } from '../penerimaanemklheader/penerimaanemklheader.service';

@Injectable()
export class PengeluaranheaderService implements OnModuleInit {
  private pengeluaranemklheaderService: PengeluaranemklheaderService;
  private penerimaanemklheaderService: PenerimaanemklheaderService;

  // Kolom teks manusiawi — HANYA ini yang boleh di-uppercase. Sebelumnya
  // create/update meng-uppercase SEMUA field string, termasuk relasi_id,
  // bank_id, alatbayar_id, daftarbank_id, statusformat, dan id — semuanya UUID
  // bertipe text alias case-sensitive. Mayoritas id di master sekarang uuid v7
  // huruf kecil, jadi blanket uppercase menulis id yang tidak ada: memilih alat
  // bayar '02-019f64f5-...' tersimpan sebagai '02-019F64F5-...' yang tak cocok
  // dengan baris alatbayar mana pun. alatbayar_id tak punya FK, jadi Postgres
  // menerimanya diam-diam; lookup lalu tampil kosong dan perubahan terlihat
  // "tidak tersimpan" tanpa satu pun error. nobukti/coakredit sengaja tak ikut:
  // keduanya identifier dan nilainya memang sudah uppercase dari sumbernya.
  private readonly uppercaseFields = [
    'keterangan',
    'dibayarke',
    'nowarkat',
    'postingdari',
    'info',
  ];

  constructor(
    // Inject wrapper RedisService (BUKAN raw 'REDIS_CLIENT'). Token REDIS_CLIENT
    // memberi instance ioredis mentah dengan enableOfflineQueue:false → saat
    // Redis mati, redisService.set() melempar "Stream isn't writeable" dan
    // menggagalkan create/update (500). Wrapper RedisService membungkus set/get
    // dengan try/catch sehingga cache bersifat best-effort (lanjut tanpa cache).
    private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly pengeluarandetailService: PengeluarandetailService,
    private readonly JurnalumumheaderService: JurnalumumheaderService,
    private readonly statuspendukungService: StatuspendukungService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    this.pengeluaranemklheaderService = this.moduleRef.get(
      PengeluaranemklheaderService,
      { strict: false },
    );
    this.penerimaanemklheaderService = this.moduleRef.get(
      PenerimaanemklheaderService,
      { strict: false },
    );
  }

  private readonly tableName = 'pengeluaranheader';
  private readonly viewName = 'vpengeluaranheader';

  private async setDateRangeSessionContext(
    trx: any,
    filters: Record<string, any>,
  ): Promise<void> {
    if (filters?.tglDari && filters?.tglSampai) {
      const tglDariFormatted = formatDateToSQL(String(filters.tglDari));
      const tglSampaiFormatted = formatDateToSQL(String(filters.tglSampai));

      if (tglDariFormatted && tglSampaiFormatted) {
        await trx.raw(`SELECT set_config('tas.tgldari', ?, true)`, [
          tglDariFormatted,
        ]);
        await trx.raw(`SELECT set_config('tas.tglsampai', ?, true)`, [
          tglSampaiFormatted,
        ]);
      }
    }

    await trx.raw(`SELECT set_config('tas.bank_id', ?, true)`, [
      filters?.bank_id ? String(filters.bank_id) : '',
    ]);
  }
  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
    alias?: string,
  ): void {
    const excludeSearchKeys: string[] = ['tglDari', 'tglSampai', 'bank_id']; // contoh kunci yang ingin dikecualikan dari pencarian
    const dateFields = [
      'created_at',
      'updated_at',
      'tglbukti',
      'tgljatuhtempo',
    ];

    const safeAlias = alias?.trim();
    const prefix = safeAlias ? `${safeAlias}.` : '';
    const formatExpr = safeAlias
      ? (col: string) => `TO_CHAR(${safeAlias}.??, 'DD-MM-YYYY HH24:MI:SS')`
      : (col: string) => `TO_CHAR(??, 'DD-MM-YYYY HH24:MI:SS')`;

    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );

    // Search: OR across all searchable fields
    if (search && searchFields.length > 0) {
      const sanitizedValue = String(search).replace(/\[/g, '[[]').trim();
      qb.where((query) => {
        searchFields.forEach((field) => {
          if (dateFields.includes(field)) {
            // ✅ pakai query, bukan qb
            query.orWhereRaw(`${formatExpr(field)} LIKE ?`, [
              field,
              `%${sanitizedValue}%`,
            ]);
          } else {
            query.orWhere(`${prefix}${field}`, 'like', `%${sanitizedValue}%`);
          }
        });
      });
    }

    // Filter: AND per field — ✅ pakai Object.entries(filters), bukan searchFields
    Object.entries(filters || {}).forEach(([key, rawValue]) => {
      if (excludeSearchKeys.includes(key)) return;
      if (rawValue === null || rawValue === undefined || rawValue === '')
        return;

      const sanitizedValue = String(rawValue).replace(/\[/g, '[[]');
      if (dateFields.includes(key)) {
        qb.andWhereRaw(`${formatExpr(key)} LIKE ?`, [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else {
        // ✅ prefix  agar konsisten dengan alias view
        qb.andWhere(`${prefix}${key}`, 'like', `%${sanitizedValue}%`);
      }
    });
  }
  async create(data: any, trx: any, options: WriteOptions = {}) {
    const { withGridPosition = true } = options;
    try {
      const { sortBy, sortDirection, filters, search, page, limit, info } =
        data;
      await this.setDateRangeSessionContext(trx, filters || {});
      const nominalValue = 0;
      const positiveNominal = '';
      const insertData = {
        nobukti: data.nobukti ?? null,
        tglbukti: formatDateToSQL(String(data?.tglbukti)),
        relasi_id: data.relasi_id ?? null,
        keterangan: data.keterangan ?? null,
        bank_id: data.bank_id ?? null,
        postingdari: data.postingdari ?? null,
        coakredit: data.coakredit ?? null,
        dibayarke: data.dibayarke ?? null,
        alatbayar_id: data.alatbayar_id ?? null,
        nowarkat: data.nowarkat ?? null,
        tgljatuhtempo: formatDateToSQL(String(data?.tgljatuhtempo)),
        daftarbank_id: data.daftarbank_id ?? null,
        statusformat: data.statusformat ?? null,
        modifiedby: data.modifiedby ?? null,
        created_at: this.utilsService.getTime(),
        updated_at: this.utilsService.getTime(),
      };

      this.uppercaseFields.forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
      const parameterCabang = await trx('parameter')
        .select(trx.raw(`JSON_VALUE(${memoExpr}, '$.CABANG_ID') AS cabang_id`))
        .where('grp', 'CABANG')
        .andWhere('subgrp', 'CABANG')
        .first();

      // Guard HARUS sebelum formatpengeluaran dipakai: bank_id kosong/tidak
      // terdaftar bikin first() undefined, dan query parameter di bawahnya
      // melempar TypeError -> user cuma dapat 500 tanpa sebab.
      if (!insertData.bank_id) {
        throw new BadRequestException('KAS/BANK WAJIB DIPILIH.');
      }

      const formatpengeluaran = await trx(`bank as b`)
        .select('p.grp', 'p.subgrp', 'b.formatpengeluaran', 'b.coa')
        .leftJoin('parameter as p', 'p.id', 'b.formatpengeluaran')
        .where('b.id', insertData.bank_id)
        .first();

      if (!formatpengeluaran) {
        throw new BadRequestException(
          'KAS/BANK YANG DIPILIH TIDAK TERDAFTAR. SILAKAN PILIH ULANG.',
        );
      }

      if (!formatpengeluaran.formatpengeluaran) {
        throw new BadRequestException(
          'FORMAT PENGELUARAN BELUM DIATUR PADA KAS/BANK YANG DIPILIH.',
        );
      }

      const parameter = await trx('parameter')
        .select(
          'grp',
          'subgrp',
          trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
        )
        .where('id', formatpengeluaran.formatpengeluaran)
        .first();

      if (!parameter) {
        throw new BadRequestException(
          'FORMAT PENGELUARAN PADA KAS/BANK YANG DIPILIH TIDAK VALID.',
        );
      }

      const cabangId = parameterCabang.cabang_id;
      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        parameter.grp,
        parameter.subgrp,
        this.tableName,
        String(insertData.tglbukti ?? ''),
        cabangId,
      );
      insertData.nobukti = nomorBukti;
      insertData.statusformat = formatpengeluaran
        ? formatpengeluaran.formatpengeluaran
        : null;
      insertData.postingdari = parameter ? parameter.memo_nama : null;

      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

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
        const detailsForPenerimaan = data.details.filter(
          (detail: any) =>
            detail.transaksilain_nobukti &&
            detail.transaksilain_nobukti.trim() !== '',
        );

        const detailsForPengeluaran = data.details.filter(
          (detail: any) =>
            !detail.transaksilain_nobukti ||
            detail.transaksilain_nobukti.trim() === '',
        );

        // ============ PROSES PENERIMAAN (yang ada transaksilain_nobukti) ============
        if (detailsForPenerimaan.length > 0) {
          const validDetailsForPenerimaan: any[] = [];

          for (const detail of detailsForPenerimaan) {
            const datapengeluaranemkl = await trx('pengeluaranemkl')
              .where('coaproses', detail.coadebet)
              .first();

            if (datapengeluaranemkl) {
              const statusPenerimaan =
                datapengeluaranemkl.nilaiprosespenerimaan;
              const nominalValue = parseNumberWithSeparators(detail.nominal);
              const isPositif = !isNaN(nominalValue) && nominalValue > 0;
              const isNegatif = !isNaN(nominalValue) && nominalValue < 0;

              if (
                isPositif &&
                // Bandingkan sebagai STRING: id parameter NILAI PROSES kini UUID,
                // sehingga Number(dataPositif.id) = NaN dan perbandingan lama
                // (Number !== Number) SELALU true -> create gagal 500 untuk
                // setiap detail yang coadebet-nya = coaproses EMKL.
                String(statusPenerimaan) !== String(dataPositif.id)
              ) {
                throw new Error(
                  `Error pada detail penerimaan dengan coadebet ${detail.coadebet}: Nominal positif harus memiliki nilaiprosespenerimaan 171 (POSITIF), tetapi mendapat ${statusPenerimaan}`,
                );
              }

              if (
                isNegatif &&
                String(statusPenerimaan) !== String(dataNegatif.id)
              ) {
                throw new Error(
                  `Error pada detail penerimaan dengan coadebet ${detail.coadebet}: Nominal negatif harus memiliki nilaiprosespenerimaan 172 (NEGATIF), tetapi mendapat ${statusPenerimaan}`,
                );
              }

              validDetailsForPenerimaan.push(detail);
            }
          }

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
            const datapenerimaanemkl = await trx('penerimaanemkl')
              .where('coaproses', firstValidDetail.coadebet)
              .first();

            const payloadPenerimaanEmklHeader = {
              tglbukti: insertData.tglbukti ?? null,
              tgljatuhtempo: insertData.tgljatuhtempo ?? null,
              keterangan: insertData.keterangan ?? null,
              karyawan_id: data.karyawan_id ?? null,
              format: datapenerimaanemkl.format ?? null,
              coaproses: datapenerimaanemkl.coaproses ?? null,
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
          const validDetailsForPengeluaran: any[] = [];

          for (const detail of detailsForPengeluaran) {
            const datapengeluaranemkl = await trx('pengeluaranemkl')
              .where('coaproses', detail.coadebet)
              .first();

            if (datapengeluaranemkl) {
              const statusPengeluaran =
                datapengeluaranemkl.nilaiprosespengeluaran;
              const nominalValue = parseNumberWithSeparators(detail.nominal);
              const isPositif = !isNaN(nominalValue) && nominalValue > 0;
              const isNegatif = !isNaN(nominalValue) && nominalValue < 0;

              if (
                isPositif &&
                String(statusPengeluaran) !== String(dataPositif.id)
              ) {
                throw new Error(
                  `Error pada detail pengeluaran dengan coadebet ${detail.coadebet}: Nominal positif harus memiliki nilaiprosespengeluaran 171 (POSITIF), tetapi mendapat ${statusPengeluaran}`,
                );
              }

              if (
                isNegatif &&
                String(statusPengeluaran) !== String(dataNegatif.id)
              ) {
                throw new Error(
                  `Error pada detail pengeluaran dengan coadebet ${detail.coadebet}: Nominal negatif harus memiliki nilaiprosespengeluaran 172 (NEGATIF), tetapi mendapat ${statusPengeluaran}`,
                );
              }

              validDetailsForPengeluaran.push(detail);
            }
          }

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

            const firstValidDetail = validDetailsForPengeluaran[0];
            const datapengeluaranemklForInsert = await trx('pengeluaranemkl')
              .where('coaproses', firstValidDetail.coadebet)
              .first();

            const payloadPengeluaranEmklHeader = {
              tglbukti: insertData.tglbukti ?? null,
              coaproses: datapengeluaranemklForInsert.coaproses ?? null,
              tgljatuhtempo: insertData.tgljatuhtempo ?? null,
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

      if (data.details.length >= 0) {
        const detailsWithNobukti = data.details.map(
          ({
            coadebet_text,
            tglinvoiceemkl,
            transaksibiaya_nobukti,
            transaksilain_nobukti,
            ...detail
          }: any) => ({
            ...detail,
            nobukti: nomorBukti,
            tglinvoiceemkl: formatDateToSQL(tglinvoiceemkl),
            modifiedby: data.modifiedby || null,
            transaksilain_nobukti:
              nobukti_transaksilain || penerimaanemklheader_nobukti,
            transaksibiaya_nobukti: transaksilain_nobukti,
          }),
        );
        await this.pengeluarandetailService.create(
          detailsWithNobukti,
          insertedItems[0].id,
          trx,
        );
      }

      const newItem = insertedItems[0];

      const processDetails = (details) => {
        return details.flatMap((detail) => [
          {
            id: '0',
            coa: detail.coadebet,
            nobukti: nomorBukti,
            tglbukti: formatDateToSQL(insertData.tglbukti),
            keterangan: detail.keterangan,
            nominaldebet: positiveNominal ? positiveNominal : detail.nominal,
            nominalkredit: '',
            modifiedby: insertData.modifiedby,
          },
          {
            id: '0',
            coa: formatpengeluaran?.coa || null,
            nobukti: nomorBukti,
            tglbukti: formatDateToSQL(insertData.tglbukti),
            keterangan: detail.keterangan,
            nominaldebet: '',
            nominalkredit: positiveNominal ? positiveNominal : detail.nominal,
            modifiedby: insertData.modifiedby,
          },
        ]);
      };

      const result = processDetails(data.details);
      const jurnalPayload = {
        nobukti: nomorBukti,
        tglbukti: insertData.tglbukti,
        postingdari: insertData.postingdari,
        statusformat: insertData.statusformat,
        keterangan: insertData.keterangan,
        created_at: this.utilsService.getTime(),
        updated_at: this.utilsService.getTime(),
        modifiedby: insertData.modifiedby,
        details: result,
      };

      await this.JurnalumumheaderService.create(jurnalPayload, trx, {
        withGridPosition: false,
      });

      // ── Posisi/pagination pasca-simpan (NON-FATAL) ───────────────────────
      // Header + detail + jurnal SUDAH ter-insert di atas. Blok ini hanya
      // menghitung posisi/halaman baris baru untuk grid (query view + findAll),
      // jadi dilewati saat dipanggil bersarang dari kas gantung: gridnya ada di
      // kas gantung, dan return value ini pun dibuang di sana.
      // Kegagalannya TIDAK boleh me-rollback simpan yang sudah berhasil.
      let pageNumber = 1;
      let fetchedPages: number[] = [1];
      const pagedData: Record<number, any> = {};
      let allFetchedData: any[] = [];
      let itemIndex: any = { zeroBasedIndex: 0 };
      if (withGridPosition) {
        try {
          const existingData = await trx(this.viewName)
            .where('id', newItem.id)
            .modify((qb) => this.applyFilters(qb, filters || {}, search))
            .first();

          const totalRecords = await trx(this.viewName)
            .count('id as total')
            .modify((qb) => this.applyFilters(qb, filters || {}, search))
            .first();
          const totalItems = Number(totalRecords?.total ?? 0);

          let posisi: number;
          if (existingData) {
            const resultposition = await trx(this.viewName)
              .count('* as posisi')
              .where((qb) => {
                qb.where(
                  sortBy,
                  sortDirection === 'desc' ? '>' : '<',
                  insertData[sortBy],
                ).orWhere((q) =>
                  q
                    .where(sortBy, insertData[sortBy])
                    .andWhere('id', '<=', newItem.id),
                );
              })
              .modify((qb) => this.applyFilters(qb, filters || {}, search))
              .first();
            posisi = Number(resultposition?.posisi ?? 0);
          } else {
            posisi = 1;
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
                customOffset: customOffset,
              },
              sort: {
                sortBy: sortBy,
                sortDirection: sortDirection.toLowerCase(),
              },
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
            'pengeluaranheader: komputasi posisi pasca-simpan gagal (non-fatal):',
            posErr?.message,
          );
        }
      }
      // ============ END GET POSITION ============

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD PENGELUARAN HEADER`,
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
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

      await this.statuspendukungService.create(
        this.tableName,
        newItem.id,
        insertData.modifiedby,
        trx,
      );

      return {
        newItem,
        itemIndex: itemIndex.zeroBasedIndex < 0 ? 0 : itemIndex.zeroBasedIndex,
        pageNumber,
        fetchedPages,
        pagedData,
      };
    } catch (error) {
      console.log(error, 'error di pengeluaran header');
      throw new Error(`Error: ${error}`);
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
      const { page = 1, limit = 0, customOffset } = pagination ?? {};

      if (isLookUp) {
        const acoCountResult = await trx(this.tableName)
          .count('id as total')
          .first();

        const acoCount = acoCountResult?.total || 0;

        if (Number(acoCount) > 500) {
          return { data: { type: 'json' } };
        }
      }
      const safeFilters = filters || {};

      await this.setDateRangeSessionContext(trx, safeFilters);

      const sortBy = sort?.sortBy || 'id';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'asc' ? 'asc' : 'desc';
      const countResult = await trx(`${this.viewName} as ab`)
        .count('ab.id as total')
        .modify((qb) => this.applyFilters(qb, safeFilters, search, 'ab'))
        .first();
      const total = Number(countResult?.total ?? 0);

      // Main query pakai view
      const query = trx(`${this.viewName} as u`).select([
        'u.id',
        'u.nobukti',
        trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
        'u.relasi_id',
        'u.keterangan',
        'u.bank_id',
        'u.postingdari',
        'u.coakredit',
        'u.dibayarke',
        'u.alatbayar_id',
        'u.nowarkat',
        trx.raw("TO_CHAR(u.tgljatuhtempo, 'DD-MM-YYYY') as tgljatuhtempo"),
        'u.daftarbank_id',
        'u.statusformat',
        'u.modifiedby',
        trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
        trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
        'u.relasi_text',
        'u.bank_text',
        'u.coakredit_text',
        'u.alatbayar_text',
        'u.daftarbank_text',
        'u.link',
      ]);

      query.modify((qb) => this.applyFilters(qb, safeFilters, search, 'u'));
      query.orderBy(`u.${sortBy}`, sortDirection);
      if (sortBy !== 'id') {
        query.orderBy('u.id', 'asc');
      }

      const offset =
        useCustomOffset === true && customOffset !== undefined
          ? customOffset
          : (page - 1) * limit;

      if (limit > 0) {
        query.offset(offset).limit(limit);
      }

      const data = await query;

      const totalPages = Math.ceil(total / limit);
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
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async findOne(id: string, trx: any) {
    try {
      const query = trx
        .from(trx.raw(`${this.tableName} as u`))
        .select([
          'u.id as id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.relasi_id',
          'u.keterangan',
          'u.bank_id',
          'u.postingdari',
          'u.coakredit',
          'u.dibayarke',
          'u.alatbayar_id',
          'u.nowarkat',
          trx.raw("TO_CHAR(u.tgljatuhtempo, 'DD-MM-YYYY') as tgljatuhtempo"),
          'u.daftarbank_id',
          'u.statusformat',
          'u.modifiedby',
          trx.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
          'r.nama as relasi_text',
          'b.nama as bank_text',
          'a.keterangancoa as coakredit_text',
          'c.nama as alatbayar_text',
          'd.nama as daftarbank_text',
        ])
        .leftJoin(trx.raw('relasi as r'), 'u.relasi_id', 'r.id')
        .leftJoin(trx.raw('bank as b'), 'u.bank_id', 'b.id')
        .leftJoin(trx.raw('akunpusat as a'), 'u.coakredit', 'a.coa')
        .leftJoin(trx.raw('alatbayar as c'), 'u.alatbayar_id', 'c.id')
        .leftJoin(trx.raw('daftarbank as d'), 'u.daftarbank_id', 'd.id')
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

  async update(id: any, data: any, trx: any, options: WriteOptions = {}) {
    const { withGridPosition = true } = options;
    try {
      data.tglbukti = formatDateToSQL(String(data?.tglbukti));
      data.tgljatuhtempo = formatDateToSQL(String(data?.tgljatuhtempo));

      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        relasi_text,
        bank_text,
        alatbayar_text,
        daftarbank_text,
        coakredit_text,
        details,
        ...insertData
      } = data;
      await this.setDateRangeSessionContext(trx, filters || {});

      this.uppercaseFields.forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      const existedData = await trx(this.tableName).where('id', id).first();
      if (!existedData) {
        throw new Error(`Pengeluaran dengan id ${id} tidak ditemukan`);
      }

      const formatpengeluaran = await trx(`bank as b`)
        .select('p.grp', 'p.subgrp', 'b.formatpengeluaran', 'b.coa')
        .leftJoin('parameter as p', 'p.id', 'b.formatpengeluaran')
        .where('b.id', insertData.bank_id || existedData.bank_id)
        .first();

      const hasChanges = this.utilsService.hasChanges(insertData, existedData);

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(insertData);
      }

      // Handle detail updates
      if (details && details.length > 0) {
        const nobuktiHeader = insertData.nobukti || existedData.nobukti;
        const cleanedDetails = details.map(
          ({ coadebet_text, tglinvoiceemkl, ...rest }) => ({
            ...rest,
            nobukti: nobuktiHeader,
            tglinvoiceemkl: formatDateToSQL(tglinvoiceemkl),
            modifiedby: insertData.modifiedby || existedData.modifiedby,
          }),
        );

        await this.pengeluarandetailService.create(cleanedDetails, id, trx);
      }

      // Update jurnal jika ada perubahan
      if (hasChanges || (details && details.length > 0)) {
        const updatedData = { ...existedData, ...insertData };
        const nobukti = updatedData.nobukti;

        const processDetails = (details) => {
          return details.flatMap((detail) => [
            {
              id: '0',
              coa: detail.coadebet,
              nobukti: nobukti,
              tglbukti: formatDateToSQL(updatedData.tglbukti),
              keterangan: detail.keterangan,
              nominaldebet: detail.nominal,
              nominalkredit: '',
              modifiedby: updatedData.modifiedby,
            },
            {
              id: '0',
              coa: formatpengeluaran?.coa || null,
              nobukti: nobukti,
              tglbukti: formatDateToSQL(updatedData.tglbukti),
              keterangan: detail.keterangan,
              nominaldebet: '',
              nominalkredit: detail.nominal,
              modifiedby: updatedData.modifiedby,
            },
          ]);
        };

        const jurnalDetails = processDetails(details || []);

        const existingJurnal = await trx('jurnalumumheader')
          .where('nobukti', nobukti)
          .first();

        if (existingJurnal) {
          const jurnalUpdatePayload = {
            nobukti: nobukti,
            tglbukti: updatedData.tglbukti,
            postingdari: updatedData.postingdari,
            statusformat: updatedData.statusformat,
            keterangan: updatedData.keterangan,
            updated_at: this.utilsService.getTime(),
            modifiedby: updatedData.modifiedby,
            details: jurnalDetails,
          };

          await this.JurnalumumheaderService.update(
            existingJurnal.id,
            jurnalUpdatePayload,
            trx,
            { withGridPosition: false },
          );
        } else {
          const jurnalCreatePayload = {
            nobukti: nobukti,
            tglbukti: updatedData.tglbukti,
            postingdari: updatedData.postingdari,
            statusformat: updatedData.statusformat,
            keterangan: updatedData.keterangan,
            created_at: this.utilsService.getTime(),
            updated_at: this.utilsService.getTime(),
            modifiedby: updatedData.modifiedby,
            details: jurnalDetails,
          };

          await this.JurnalumumheaderService.create(jurnalCreatePayload, trx, {
            withGridPosition: false,
          });
        }
      }

      // ============ GET POSITION ============
      // Dilewati saat dipanggil bersarang (kas gantung / pengeluaran emkl):
      // grid yang menunggu bukan grid pengeluaran, dan payload bersarang tidak
      // membawa sortBy/limit sehingga query posisi menembak kolom undefined.
      let pageNumber = 1;
      let fetchedPages: number[] = [1];
      const pagedData: Record<number, any> = {};
      let allFetchedData: any[] = [];
      let itemIndex: any = { zeroBasedIndex: 0 };

      if (withGridPosition) {
        const existingData = await trx(this.tableName)
          .where('id', id)
          .modify((qb) => this.applyFilters(qb, filters || {}, search))
          .first();

        // totalItems selalu dihitung dengan filter — fix bug utama
        const totalRecords = await trx(this.viewName)
          .count('id as total')
          .modify((qb) => this.applyFilters(qb, filters || {}, search))
          .first();
        const totalItems = Number(totalRecords?.total ?? 0);
        const LastId = await trx(this.viewName)
          .select('id')
          .orderBy('id', 'desc')
          .first();

        let posisi: number;
        if (existingData) {
          const resultposition = await trx(this.viewName)
            .count('* as posisi')
            .where(
              sortBy,
              sortDirection === 'desc' ? '>=' : '<=',
              insertData[sortBy],
            )
            .where('id', '<=', LastId.id)
            .modify((qb) => this.applyFilters(qb, filters || {}, search))
            .first();
          posisi = Number(resultposition?.posisi ?? 0);
        } else {
          posisi = 1;
        }

        pageNumber = Math.ceil(posisi / limit);
        const totalPages = Math.ceil(totalItems / limit);

        fetchedPages = getFetchedPages(pageNumber, totalPages);

        const startPage = fetchedPages[0];
        const endPage = fetchedPages[fetchedPages.length - 1];

        const customOffset = (startPage - 1) * limit;
        const totalDataNeeded = (endPage - startPage + 1) * limit;

        const result = await this.findAll(
          {
            search: search || '',
            filters: filters || {},
            pagination: {
              page: startPage,
              limit: totalDataNeeded,
              customOffset: customOffset,
            },
            sort: {
              sortBy: sortBy,
              sortDirection: sortDirection.toLowerCase(),
            },
            isLookUp: false,
            useCustomOffset: true,
          },
          trx,
        );

        allFetchedData = result.data;

        let dataIndex = 0;
        fetchedPages.forEach((pageNum) => {
          pagedData[pageNum] = allFetchedData.slice(
            dataIndex,
            dataIndex + limit,
          );
          dataIndex += limit;
        });

        itemIndex = calculateItemIndex(Number(posisi), fetchedPages, limit);
      }
      // ============ END GET POSITION ============

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `EDIT PENGELUARAN HEADER`,
          idtrans: id,
          nobuktitrans: id,
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
      console.error('Error in pengeluaran update:', error);
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
        'pengeluarandetail',
        'pengeluaran_id',
        trx,
      );
      await this.statuspendukungService.remove(id, modifiedby, trx);

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE PENGELUARAN DETAIL',
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

  /**
   * Data untuk LaporanPengeluaran.mrt: `data` (satu baris header + kolom
   * tambahan judul/usercetak/tglcetak/terbilang) dan `detail` (rincian coa).
   * Sebelumnya dirakit di browser sebelum cetak dipindah ke backend.
   *
   * `db` boleh berupa instance knex tanpa transaksi: ini murni pembacaan dan
   * job-nya berumur panjang, jadi tidak ada gunanya menahan koneksi. findOne
   * membaca tabel base + JOIN sendiri (bukan vpengeluaranheader), sehingga
   * tidak bergantung pada GUC periode yang hanya hidup di dalam transaksi.
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

    const detailRes = await this.pengeluarandetailService.findAll(
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
          judullaporan: judullaporan ?? 'Laporan Pengeluaran',
          usercetak: username,
          tglcetak,
          terbilang: numberToTerbilang(totalNominal),
          judul: 'Bukti Pengeluaran KAS EMKL',
        },
      ],
      detail: details,
    };
  }

  /**
   * Filter periode/bank untuk jalur TANPA transaksi (export background).
   *
   * findAll menurunkan tglDari/tglSampai/bank_id ke view lewat GUC
   * (`set_config(..., true)`) yang umurnya seumur transaksi. Export tidak
   * dibungkus transaksi, jadi GUC-nya tidak pernah ter-set dan view akan
   * memulangkan SELURUH periode. Di sini ketiganya dipasang sebagai predikat
   * biasa supaya hasil export sama dengan yang terlihat di grid.
   */
  private applyPeriodFilters(
    qb: any,
    filters: Record<string, any>,
    alias: string,
  ): void {
    const tglDari = filters?.tglDari
      ? formatDateToSQL(String(filters.tglDari))
      : null;
    const tglSampai = filters?.tglSampai
      ? formatDateToSQL(String(filters.tglSampai))
      : null;

    if (tglDari && tglSampai) {
      qb.whereBetween(`${alias}.tglbukti`, [tglDari, tglSampai]);
    }

    // Cocok PERSIS (bukan LIKE): bank_id adalah identifier, dan di view pun
    // perbandingannya `=`.
    if (filters?.bank_id) {
      qb.andWhere(`${alias}.bank_id`, String(filters.bank_id));
    }
  }

  /**
   * Query dasar export: filter, search, dan sort yang sama dengan findAll,
   * TANPA paging dan hanya kolom yang dipakai file Excel.
   *
   * Dipisah supaya export bisa di-stream lewat cursor (`.stream()`) — menarik
   * seluruh baris ke sebuah array lebih dulu adalah yang membuat proses
   * kehabisan heap saat datanya banyak.
   */
  buildExportQuery(
    {
      search,
      filters,
      sort,
    }: Pick<FindAllParams, 'search' | 'filters' | 'sort'>,
    db: any,
  ) {
    const sortBy = sort?.sortBy || 'nobukti';
    const sortDirection =
      sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
    const safeFilters = filters || {};

    const query = db(`${this.viewName} as u`)
      .select([
        'u.nobukti',
        db.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
        db.raw("TO_CHAR(u.tgljatuhtempo, 'DD-MM-YYYY') as tgljatuhtempo"),
        'u.keterangan',
        'u.relasi_text',
        'u.bank_text',
        'u.coakredit_text',
        'u.alatbayar_text',
        'u.nowarkat',
        'u.dibayarke',
        'u.modifiedby',
        db.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
        db.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
      ])
      .modify((qb: any) => this.applyFilters(qb, safeFilters, search, 'u'))
      .modify((qb: any) => this.applyPeriodFilters(qb, safeFilters, 'u'));

    // Urutan HARUS deterministik — sama alasannya dengan findAll.
    query.orderBy(`u.${sortBy}`, sortDirection);
    if (sortBy !== 'id') {
      query.orderBy('u.id', 'asc');
    }

    return query;
  }

  /** Jumlah baris yang akan diekspor — dipakai untuk progres export yang nyata. */
  async countExportRows(
    { search, filters }: Pick<FindAllParams, 'search' | 'filters'>,
    db: any,
  ): Promise<number> {
    const safeFilters = filters || {};

    const result = await db(`${this.viewName} as u`)
      .count('u.id as total')
      .modify((qb: any) => this.applyFilters(qb, safeFilters, search, 'u'))
      .modify((qb: any) => this.applyPeriodFilters(qb, safeFilters, 'u'))
      .first();

    return Number(result?.total ?? 0);
  }

  /** Definisi sheet export daftar — dipakai jalur background (streaming). */
  readonly exportSheet = {
    sheetName: 'Data Export',
    titleLines: [
      'PT. TRANSPORINDO AGUNG SEJAHTERA',
      'LAPORAN PENGELUARAN',
      'Data Export',
    ],
    headers: [
      'NO.',
      'NO BUKTI',
      'TGL BUKTI',
      'TGL JATUH TEMPO',
      'KETERANGAN',
      'RELASI',
      'BANK / KAS',
      'COA KREDIT',
      'ALAT BAYAR',
      'NO WARKAT',
      'DIBAYAR KE',
      'MODIFIED BY',
      'CREATED AT',
      'UPDATED AT',
    ],
    mapRow: (row: any, rowNumber: number) => [
      rowNumber,
      row.nobukti,
      row.tglbukti,
      row.tgljatuhtempo,
      row.keterangan,
      row.relasi_text,
      row.bank_text,
      row.coakredit_text,
      row.alatbayar_text,
      row.nowarkat,
      row.dibayarke,
      row.modifiedby,
      row.created_at,
      row.updated_at,
    ],
  };

  async exportToExcel(data: any[], trx: any) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    // Header laporan
    worksheet.mergeCells('A1:D1'); // Ubah dari E1 ke D1 karena hanya 4 kolom
    worksheet.mergeCells('A2:D2'); // Ubah dari E2 ke D2 karena hanya 4 kolom
    worksheet.mergeCells('A3:D3'); // Ubah dari E3 ke D3 karena hanya 4 kolom

    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN PENGELUARAN';
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
      const detailRes = await this.pengeluarandetailService.findAll(
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
        ['Tanggal', h.tglbukti ?? ''],
        ['Bank / Kas', h.bank_text ?? ''],
        ['Tanggal Kas', h.tgljatuhtempo ?? ''],
        ['Relasi', h.relasi_text ?? ''],
      ];

      // Merge kolom A dan B untuk seluruh area header info
      const headerStartRow = currentRow;
      const headerEndRow = currentRow + headerInfo.length - 1;

      headerInfo.forEach(([label, value]) => {
        worksheet.getCell(`A${currentRow}`).value = label;
        worksheet.getCell(`A${currentRow}`).font = {
          bold: true,
          name: 'Tahoma',
          size: 10,
        };
        worksheet.getCell(`C${currentRow}`).value = value;
        worksheet.getCell(`C${currentRow}`).font = {
          name: 'Tahoma',
          size: 10,
        };
        currentRow++;
      });

      for (let row = headerStartRow; row <= headerEndRow; row++) {
        worksheet.mergeCells(`A${row}:B${row}`);
      }

      currentRow++;

      if (details.length > 0) {
        const tableHeaders = ['NO.', 'NAMA PERKIRAAN', 'KETERANGAN', 'NOMINAL'];

        tableHeaders.forEach((header, index) => {
          const cell = worksheet.getCell(currentRow, index + 1);
          cell.value = header;
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFF00' },
          };
          cell.font = {
            bold: true,
            name: 'Tahoma',
            size: 10,
          };
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
        currentRow++;

        details.forEach((d: any, detailIndex: number) => {
          const rowValues = [
            detailIndex + 1,
            d.coadebet_text ?? '',
            d.keterangan ?? '',
            d.nominal ?? 0,
          ];

          rowValues.forEach((value, colIndex) => {
            const cell = worksheet.getCell(currentRow, colIndex + 1);
            cell.value = value;
            cell.font = {
              name: 'Tahoma',
              size: 10,
            };

            if (colIndex === 3) {
              cell.alignment = { horizontal: 'right', vertical: 'middle' };
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

        const totalNominal = details.reduce(
          (sum: number, d: any) => sum + (Number(d.nominal) || 0),
          0,
        );

        const totalLabelCell = worksheet.getCell(currentRow, 3);
        totalLabelCell.value = 'TOTAL';
        totalLabelCell.font = { bold: true, name: 'Tahoma', size: 10 };
        totalLabelCell.alignment = { horizontal: 'left', vertical: 'middle' };
        totalLabelCell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };

        const totalValueCell = worksheet.getCell(currentRow, 4);
        totalValueCell.value = totalNominal;
        totalValueCell.font = { bold: true, name: 'Tahoma', size: 10 };
        totalValueCell.alignment = { horizontal: 'right', vertical: 'middle' };
        totalValueCell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };

        currentRow++;
      }
    }

    worksheet.getColumn(1).width = 6;

    worksheet.getColumn(2).width = 35;

    worksheet.getColumn(3).width = 25;

    worksheet.getColumn(4).width = 15;

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_pengeluaran${Date.now()}.xlsx`,
    );

    await workbook.xlsx.writeFile(tempFilePath);
    return tempFilePath;
  }
}
