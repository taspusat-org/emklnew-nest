import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { RedisService } from 'src/common/redis/redis.service';
import {
  withUuidV7,
  formatDateToSQL,
  UtilsService,
  calculateItemIndex,
  getFetchedPages,
} from 'src/utils/utils.service';
import { numberToTerbilang } from 'src/utils/terbilang';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { HutangdetailService } from '../hutangdetail/hutangdetail.service';
import { JurnalumumheaderService } from '../jurnalumumheader/jurnalumumheader.service';
import * as fs from 'fs';
import * as path from 'path';
import { Workbook } from 'exceljs';
import { StatuspendukungService } from '../statuspendukung/statuspendukung.service';

@Injectable()
export class HutangheaderService {
  // Kolom teks manusiawi — HANYA ini yang boleh di-uppercase. Sebelumnya
  // `nobukti` ikut di-uppercase; itu tidak berguna (nilainya datang dari
  // generateRunningNumber yang memang sudah uppercase) dan berbahaya sebagai
  // pola, karena kolom identifier lain (id, relasi_id, statusformat, coa)
  // bertipe text case-sensitive dan mayoritas id master kini uuid v7 HURUF
  // KECIL. Blanket uppercase menulis id yang tidak ada; tanpa FK Postgres
  // menerimanya diam-diam sehingga lookup tampil kosong dan perubahan terlihat
  // "tidak tersimpan" tanpa satu pun error — lihat pengeluaranheader.service.ts.
  private readonly uppercaseFields = ['keterangan', 'info'];

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
    private readonly hutangdetailService: HutangdetailService,
    private readonly JurnalumumheaderService: JurnalumumheaderService,
    private readonly statuspendukungService: StatuspendukungService,
  ) {}

  private readonly tableName = 'hutangheader';
  // Baca lewat view, tulis lewat tabel base — pola yang sama dengan
  // pengeluaranheader (vpengeluaranheader). View sudah memuat relasi_text,
  // coa_text, dan link sehingga findAll tidak perlu JOIN + membangun tabel temp
  // per request; itu syarat agar windowed pagination (grid menarik 5 halaman
  // sekaligus) tetap murah.
  private readonly viewName = 'vhutangheader';

  private async setDateRangeSessionContext(
    trx: any,
    filters: Record<string, any>,
  ): Promise<void> {
    // DB tasemkl adalah PostgreSQL (dbMssql cuma nama variabel). Filter periode
    // diturunkan ke view lewat GUC per-transaksi:
    //   set_config('tas.hutang_*', value, true)
    // is_local=true → otomatis reset di akhir transaksi (findAll dibungkus satu
    // transaksi di controller) jadi tidak bocor ke request lain lewat koneksi
    // pool. View vhutangheader membacanya via current_setting('tas.hutang_*',
    // true) dan memperlakukan '' sebagai "tanpa filter" (NULLIF(...,'')).
    if (filters?.tglDari && filters?.tglSampai) {
      const tglDariFormatted = formatDateToSQL(String(filters.tglDari));
      const tglSampaiFormatted = formatDateToSQL(String(filters.tglSampai));

      if (tglDariFormatted && tglSampaiFormatted) {
        await trx.raw(`SELECT set_config('tas.hutang_tgldari', ?, true)`, [
          tglDariFormatted,
        ]);
        await trx.raw(`SELECT set_config('tas.hutang_tglsampai', ?, true)`, [
          tglSampaiFormatted,
        ]);
      }
    }

    // relasi_id opsional: '' = tanpa filter, di-set eksplisit tiap kali agar
    // tidak terbawa dari transaksi sebelumnya di koneksi pool yang sama.
    await trx.raw(`SELECT set_config('tas.hutang_relasi_id', ?, true)`, [
      filters?.relasi_id ? String(filters.relasi_id) : '',
    ]);
  }

  /**
   * Filter + search, dipakai bersama oleh query COUNT dan query DATA supaya
   * total & halaman selalu konsisten. Dulu total dihitung dari
   * `trx(tableName).count()` tanpa filter apa pun, sehingga totalPages di grid
   * selalu menghitung SELURUH baris — infinite scroll tidak pernah berhenti di
   * halaman terakhir yang benar.
   */
  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
    alias?: string,
  ): void {
    // tglDari/tglSampai/relasi_id diturunkan ke view lewat GUC, jadi jangan
    // ikut jadi predikat LIKE di sini.
    const excludeSearchKeys: string[] = ['tglDari', 'tglSampai', 'relasi_id'];
    const dateFields = [
      'created_at',
      'updated_at',
      'tglbukti',
      'tgljatuhtempo',
    ];

    const safeAlias = alias?.trim();
    const prefix = safeAlias ? `${safeAlias}.` : '';
    const formatExpr = safeAlias
      ? () => `TO_CHAR(${safeAlias}.??, 'DD-MM-YYYY HH24:MI:SS')`
      : () => `TO_CHAR(??, 'DD-MM-YYYY HH24:MI:SS')`;

    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );

    // Search: OR across all searchable fields
    if (search && searchFields.length > 0) {
      const sanitizedValue = String(search).replace(/\[/g, '[[]').trim();
      qb.where((query: any) => {
        searchFields.forEach((field) => {
          if (dateFields.includes(field)) {
            query.orWhereRaw(`${formatExpr()} LIKE ?`, [
              field,
              `%${sanitizedValue}%`,
            ]);
          } else {
            query.orWhere(`${prefix}${field}`, 'like', `%${sanitizedValue}%`);
          }
        });
      });
    }

    // Filter: AND per field
    Object.entries(filters || {}).forEach(([key, rawValue]) => {
      if (excludeSearchKeys.includes(key)) return;
      if (rawValue === null || rawValue === undefined || rawValue === '')
        return;

      const sanitizedValue = String(rawValue).replace(/\[/g, '[[]');
      if (dateFields.includes(key)) {
        qb.andWhereRaw(`${formatExpr()} LIKE ?`, [key, `%${sanitizedValue}%`]);
      } else {
        qb.andWhere(`${prefix}${key}`, 'like', `%${sanitizedValue}%`);
      }
    });
  }

  async create(data: any, trx: any) {
    try {
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        coa_text,
        relasi_text,
        details,
        modifiedby,
        created_at,
        updated_at,
        ...insertData
      } = data;

      await this.setDateRangeSessionContext(trx, filters || {});

      this.uppercaseFields.forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      insertData.tglbukti = formatDateToSQL(String(insertData?.tglbukti));
      insertData.tgljatuhtempo = formatDateToSQL(
        String(insertData?.tgljatuhtempo),
      );
      insertData.modifiedby = modifiedby;
      insertData.created_at = created_at || this.utilsService.getTime();
      insertData.updated_at = updated_at || this.utilsService.getTime();

      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
      const getParam = await trx('parameter')
        .select([
          'id',
          'grp',
          'subgrp',
          'kelompok',
          trx.raw(`JSON_VALUE(${memoExpr}, '$.COA') as coa_nama`),
          trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') as memo_nama`),
        ])
        .whereRaw("RTRIM(LTRIM(grp)) = 'NOMOR HUTANG'")
        .andWhereRaw("RTRIM(LTRIM(subgrp)) = 'NOMOR HUTANG'")
        .andWhereRaw("RTRIM(LTRIM(kelompok)) = 'HUTANG'")
        .first();

      if (!getParam) {
        throw new Error(`Parameter tidak ditemukan`);
      }

      const defaultCoa = getParam.coa_nama;
      if (!defaultCoa) {
        throw new Error(
          'Default COA untuk jurnal umum tidak ditemukan di memo',
        );
      }

      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        getParam.grp,
        getParam.subgrp,
        this.tableName,
        insertData.tglbukti,
      );
      insertData.nobukti = nomorBukti;
      insertData.coa = defaultCoa;
      insertData.statusformat = getParam.id ?? null;

      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

      const newItem = insertedItems[0];

      if (details && details.length > 0) {
        const detailsWithNobukti = details.map(
          ({ coa_text: _coaText, tglinvoiceemkl, ...detail }: any) => ({
            ...detail,
            tglinvoiceemkl: formatDateToSQL(tglinvoiceemkl),
            nobukti: nomorBukti,
            modifiedby: modifiedby || null,
          }),
        );
        await this.hutangdetailService.create(
          detailsWithNobukti,
          newItem.id,
          trx,
        );
      }

      const processDetails = (rows: any[]) =>
        rows.flatMap((detail: any) => [
          {
            id: 0,
            coa: detail.coa,
            nobukti: nomorBukti,
            tglbukti: formatDateToSQL(insertData.tglbukti),
            keterangan: detail.keterangan,
            nominaldebet: detail.nominal,
            nominalkredit: '',
            modifiedby: insertData.modifiedby,
          },
          {
            id: 0,
            coa: defaultCoa,
            nobukti: nomorBukti,
            tglbukti: formatDateToSQL(insertData.tglbukti),
            keterangan: detail.keterangan,
            nominaldebet: '',
            nominalkredit: detail.nominal,
            modifiedby: insertData.modifiedby,
          },
        ]);

      const jurnalPayload = {
        nobukti: nomorBukti,
        tglbukti: insertData.tglbukti,
        postingdari: getParam.memo_nama,
        statusformat: getParam.id,
        keterangan: insertData.keterangan,
        created_at: this.utilsService.getTime(),
        updated_at: this.utilsService.getTime(),
        modifiedby: insertData.modifiedby,
        details: processDetails(details ?? []),
      };

      await this.JurnalumumheaderService.create(jurnalPayload, trx);

      // ── Posisi/pagination pasca-simpan (NON-FATAL) ───────────────────────
      // Header + detail + jurnal SUDAH ter-insert di atas. Blok ini hanya
      // menghitung posisi/halaman baris baru untuk grid (query view + findAll).
      // Kegagalannya (mis. sortBy undefined) TIDAK boleh me-rollback simpan yang
      // sudah berhasil. Default posisi bila gagal.
      let pageNumber = 1;
      let fetchedPages: number[] = [1];
      const pagedData: Record<number, any> = {};
      let allFetchedData: any[] = [];
      let itemIndex: any = { zeroBasedIndex: 0 };
      const effectiveLimit = Number(limit) > 0 ? Number(limit) : 10;
      const effectiveSortBy = sortBy || 'nobukti';
      const effectiveSortDirection =
        String(sortDirection).toLowerCase() === 'desc' ? 'desc' : 'asc';

      try {
        const existingData = await trx(this.viewName)
          .where('id', newItem.id)
          .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
          .first();

        const totalRecords = await trx(this.viewName)
          .count('id as total')
          .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
          .first();
        const totalItems = Number(totalRecords?.total ?? 0);

        let posisi: number;
        if (existingData) {
          // Nilai pembanding diambil dari BARIS VIEW, bukan dari insertData.
          // sortBy boleh berupa kolom turunan yang hanya ada di view
          // (relasi_text, coa_text, link) — insertData tidak punya kunci itu,
          // sehingga pembanding jadi undefined dan posisi selalu meleset.
          const sortValue = existingData[effectiveSortBy];
          const resultposition = await trx(this.viewName)
            .count('* as posisi')
            .where((qb: any) => {
              qb.where(
                effectiveSortBy,
                effectiveSortDirection === 'desc' ? '>' : '<',
                sortValue,
              ).orWhere((q: any) =>
                q
                  .where(effectiveSortBy, sortValue)
                  .andWhere('id', '<=', newItem.id),
              );
            })
            .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
            .first();
          posisi = Number(resultposition?.posisi ?? 0);
        } else {
          posisi = 1;
        }

        pageNumber = Math.ceil(posisi / effectiveLimit);
        const totalPages = Math.ceil(totalItems / effectiveLimit);
        fetchedPages = getFetchedPages(pageNumber, totalPages);
        const startPage = fetchedPages[0];
        const endPage = fetchedPages[fetchedPages.length - 1];
        const customOffset = (startPage - 1) * effectiveLimit;
        const totalDataNeeded = (endPage - startPage + 1) * effectiveLimit;

        const findAllResult = await this.findAll(
          {
            search: search || '',
            filters: filters || {},
            pagination: {
              page: startPage,
              limit: totalDataNeeded,
              customOffset,
            },
            sort: {
              sortBy: effectiveSortBy,
              sortDirection: effectiveSortDirection,
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
            dataIndex + effectiveLimit,
          );
          dataIndex += effectiveLimit;
        });

        itemIndex = calculateItemIndex(
          Number(posisi),
          fetchedPages,
          effectiveLimit,
        );
      } catch (posErr: any) {
        console.warn(
          'hutangheader: komputasi posisi pasca-simpan gagal (non-fatal):',
          posErr?.message,
        );
      }
      // ============ END GET POSITION ============

      await this.statuspendukungService.create(
        this.tableName,
        newItem.id,
        modifiedby,
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD HUTANG HEADER`,
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      await this.redisService.set(
        `${this.tableName}-page-${pageNumber}`,
        JSON.stringify(allFetchedData),
      );

      return {
        newItem,
        itemIndex: itemIndex.zeroBasedIndex < 0 ? 0 : itemIndex.zeroBasedIndex,
        pageNumber,
        fetchedPages,
        pagedData,
      };
    } catch (error: any) {
      console.error('Error di hutang header create:', error);
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
        sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';

      // COUNT memakai filter yang SAMA dengan query data (lihat applyFilters).
      const countResult = await trx(`${this.viewName} as ab`)
        .count('ab.id as total')
        .modify((qb: any) => this.applyFilters(qb, safeFilters, search, 'ab'))
        .first();
      const total = Number(countResult?.total ?? 0);

      const query = trx(`${this.viewName} as u`).select([
        'u.id',
        'u.nobukti',
        trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
        trx.raw("TO_CHAR(u.tgljatuhtempo, 'DD-MM-YYYY') as tgljatuhtempo"),
        'u.keterangan',
        'u.relasi_id',
        'u.coa',
        'u.statusformat',
        'u.info',
        'u.modifiedby',
        trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
        trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
        'u.relasi_text',
        'u.coa_text',
        'u.link',
      ]);

      query.modify((qb: any) => this.applyFilters(qb, safeFilters, search, 'u'));

      // Urutan HARUS deterministik: tanpa tiebreaker unik, offset/limit bisa
      // memulangkan baris yang sama di dua halaman berbeda (atau melewatkan
      // baris) saat grid menggeser window.
      query.orderBy(`u.${sortBy}`, sortDirection);
      if (sortBy !== 'id') {
        query.orderBy('u.id', 'asc');
      }

      const offset =
        useCustomOffset === true && customOffset !== undefined
          ? customOffset
          : (Number(page) - 1) * Number(limit);

      if (Number(limit) > 0) {
        query.offset(offset).limit(Number(limit));
      }

      const data = await query;

      const totalPages = Number(limit) > 0 ? Math.ceil(total / Number(limit)) : 1;
      const responseType = total > 500 ? 'json' : 'local';

      return {
        data,
        type: responseType,
        total,
        pagination: {
          currentPage: Number(page),
          totalPages,
          totalItems: total,
          itemsPerPage: Number(limit),
        },
      };
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async findOne(id: string, trx: any) {
    try {
      const data = await trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          trx.raw("TO_CHAR(u.tgljatuhtempo, 'DD-MM-YYYY') as tgljatuhtempo"),
          'u.keterangan',
          'u.relasi_id',
          'u.coa',
          'u.statusformat',
          'u.info',
          'u.modifiedby',
          trx.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
          'r.nama as relasi_text',
          'a.keterangancoa as coa_text',
        ])
        .leftJoin(trx.raw('relasi as r'), 'u.relasi_id', 'r.id')
        .leftJoin(trx.raw('akunpusat as a'), 'u.coa', 'a.coa')
        .where('u.id', id);

      return {
        data,
      };
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  /**
   * Data untuk cetak bukti Hutang (LaporanHutang.mrt).
   *
   * Template-nya punya DUA datasource: `data` (header bukti) dan `detail`
   * (rincian coa/nominal), jadi yang dikembalikan objek bernama — bukan array
   * seperti laporan daftar. Kolom tambahan di header (judullaporan, usercetak,
   * tglcetak, terbilang, judul) tidak ada di database; semuanya dipakai band
   * header template dan dulu dirakit di browser sebelum cetak dipindah ke
   * backend.
   *
   * `db` boleh berupa instance knex tanpa transaksi: ini murni pembacaan dan
   * job-nya berumur panjang, jadi tidak ada gunanya menahan koneksi. findOne
   * membaca tabel base + JOIN sendiri (bukan vhutangheader), sehingga tidak
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

    const detailRes = await this.hutangdetailService.findAll(
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
          judullaporan: judullaporan ?? 'Laporan Hutang',
          usercetak: username,
          tglcetak,
          terbilang: numberToTerbilang(totalNominal),
          judul: 'Bukti Hutang',
        },
      ],
      detail: details,
    };
  }

  async update(id: any, data: any, trx: any) {
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
        coa_text,
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
        throw new Error(`Hutang dengan id ${id} tidak ditemukan`);
      }

      if (!insertData.coa) {
        insertData.coa = existedData?.coa;
      }

      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
      const getParam = await trx('parameter')
        .select([
          'id',
          'grp',
          'subgrp',
          'kelompok',
          trx.raw(`JSON_VALUE(${memoExpr}, '$.COA') as coa_nama`),
          trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') as memo_nama`),
        ])
        .whereRaw("RTRIM(LTRIM(grp)) = 'NOMOR HUTANG'")
        .andWhereRaw("RTRIM(LTRIM(subgrp)) = 'NOMOR HUTANG'")
        .andWhereRaw("RTRIM(LTRIM(kelompok)) = 'HUTANG'")
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
          ({ coa_text: _coaText, tglinvoiceemkl, ...rest }: any) => ({
            ...rest,
            nobukti: nobuktiHeader,
            tglinvoiceemkl: formatDateToSQL(tglinvoiceemkl),
            modifiedby: insertData.modifiedby || existedData.modifiedby,
          }),
        );

        await this.hutangdetailService.create(cleanedDetails, id, trx);
      }

      // Update jurnal jika ada perubahan
      if (hasChanges || (details && details.length > 0)) {
        const updatedData = { ...existedData, ...insertData };
        const nobukti = updatedData.nobukti;

        if (!getParam) {
          console.warn(
            'Parameter untuk jurnal tidak ditemukan, skip update jurnal',
          );
        } else if (!getParam.coa_nama) {
          console.warn(
            'Default COA untuk jurnal tidak ditemukan di memo, skip update jurnal',
          );
        } else {
          const defaultCoa = getParam.coa_nama;

          const processDetails = (rows: any[]) =>
            rows.flatMap((detail: any) => [
              {
                id: 0,
                coa: detail.coa,
                nobukti,
                tglbukti: formatDateToSQL(updatedData.tglbukti),
                keterangan: detail.keterangan,
                nominaldebet: detail.nominal,
                nominalkredit: '',
                modifiedby: updatedData.modifiedby,
              },
              {
                id: 0,
                coa: defaultCoa,
                nobukti,
                tglbukti: formatDateToSQL(updatedData.tglbukti),
                keterangan: detail.keterangan,
                nominaldebet: '',
                nominalkredit: detail.nominal,
                modifiedby: updatedData.modifiedby,
              },
            ]);

          const jurnalDetails = processDetails(details || []);

          const existingJurnal = await trx('jurnalumumheader')
            .where('nobukti', nobukti)
            .first();

          if (existingJurnal) {
            await this.JurnalumumheaderService.update(
              existingJurnal.id,
              {
                nobukti,
                tglbukti: updatedData.tglbukti,
                postingdari: getParam.memo_nama,
                statusformat: getParam.id,
                keterangan: updatedData.keterangan,
                updated_at: this.utilsService.getTime(),
                modifiedby: updatedData.modifiedby,
                details: jurnalDetails,
              },
              trx,
            );
          } else {
            await this.JurnalumumheaderService.create(
              {
                nobukti,
                tglbukti: updatedData.tglbukti,
                postingdari: getParam.memo_nama,
                statusformat: getParam.id,
                keterangan: updatedData.keterangan,
                created_at: this.utilsService.getTime(),
                updated_at: this.utilsService.getTime(),
                modifiedby: updatedData.modifiedby,
                details: jurnalDetails,
              },
              trx,
            );
          }
        }
      }

      // ============ GET POSITION ============
      const effectiveLimit = Number(limit) > 0 ? Number(limit) : 10;
      const effectiveSortBy = sortBy || 'nobukti';
      const effectiveSortDirection =
        String(sortDirection).toLowerCase() === 'desc' ? 'desc' : 'asc';

      const existingData = await trx(this.viewName)
        .where('id', id)
        .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
        .first();

      // totalItems selalu dihitung dengan filter yang sama seperti query data.
      const totalRecords = await trx(this.viewName)
        .count('id as total')
        .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
        .first();
      const totalItems = Number(totalRecords?.total ?? 0);

      let posisi: number;
      if (existingData) {
        // Sama seperti create: pembanding diambil dari baris VIEW agar sortBy
        // berupa kolom turunan (relasi_text/coa_text) tetap benar.
        const sortValue = existingData[effectiveSortBy];
        const resultposition = await trx(this.viewName)
          .count('* as posisi')
          .where((qb: any) => {
            qb.where(
              effectiveSortBy,
              effectiveSortDirection === 'desc' ? '>' : '<',
              sortValue,
            ).orWhere((q: any) =>
              q.where(effectiveSortBy, sortValue).andWhere('id', '<=', id),
            );
          })
          .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
          .first();
        posisi = Number(resultposition?.posisi ?? 0);
      } else {
        posisi = 1;
      }

      const pageNumber = Math.ceil(posisi / effectiveLimit);
      const totalPages = Math.ceil(totalItems / effectiveLimit);
      const fetchedPages = getFetchedPages(pageNumber, totalPages);

      const startPage = fetchedPages[0];
      const endPage = fetchedPages[fetchedPages.length - 1];
      const customOffset = (startPage - 1) * effectiveLimit;
      const totalDataNeeded = (endPage - startPage + 1) * effectiveLimit;

      const result = await this.findAll(
        {
          search: search || '',
          filters: filters || {},
          pagination: {
            page: startPage,
            limit: totalDataNeeded,
            customOffset,
          },
          sort: {
            sortBy: effectiveSortBy,
            sortDirection: effectiveSortDirection,
          },
          isLookUp: false,
          useCustomOffset: true,
        },
        trx,
      );

      const allFetchedData = result.data ?? [];
      const pagedData: Record<number, any> = {};
      let dataIndex = 0;

      fetchedPages.forEach((pageNum) => {
        pagedData[pageNum] = allFetchedData.slice(
          dataIndex,
          dataIndex + effectiveLimit,
        );
        dataIndex += effectiveLimit;
      });

      const itemIndex = calculateItemIndex(
        Number(posisi),
        fetchedPages,
        effectiveLimit,
      );
      // ============ END GET POSITION ============

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `EDIT HUTANG HEADER`,
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      await this.redisService.set(
        `${this.tableName}-page-${pageNumber}`,
        JSON.stringify(allFetchedData),
      );

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
    } catch (error: any) {
      console.error('Error in hutang update:', error);
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
        'hutangdetail',
        'hutang_id',
        trx,
      );
      await this.statuspendukungService.remove(id, modifiedby, trx);

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE HUTANG DETAIL',
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
   * tglDari/tglSampai/relasi_id di findAll tidak jadi predikat SQL: ketiganya
   * diturunkan ke vhutangheader lewat GUC per-transaksi (set_config dengan
   * is_local=true, lihat setDateRangeSessionContext) dan karena itu sengaja
   * dikecualikan dari applyFilters.
   *
   * Export TIDAK bisa memakai jalur itu. Job-nya berumur panjang dan barisnya
   * ditarik lewat cursor tanpa transaksi, sehingga set_config(..., true) hilang
   * begitu statement-nya selesai — view lalu memulangkan SELURUH periode dan
   * file Excel-nya berisi data di luar filter yang dipilih user. Jadi di sini
   * ketiganya dipasang sebagai predikat biasa; klausanya sama persis dengan
   * yang ada di dalam view.
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

    // Cocok PERSIS (bukan LIKE): relasi_id adalah identifier, dan di view pun
    // perbandingannya `=`.
    if (filters?.relasi_id) {
      qb.andWhere(`${alias}.relasi_id`, String(filters.relasi_id));
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
        'u.coa_text',
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
      'LAPORAN HUTANG',
      'Data Export',
    ],
    headers: [
      'NO.',
      'NO BUKTI',
      'TGL BUKTI',
      'TGL JATUH TEMPO',
      'KETERANGAN',
      'RELASI',
      'COA',
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
      row.coa_text,
      row.modifiedby,
      row.created_at,
      row.updated_at,
    ],
  };

  async exportToExcel(data: any[], trx: any) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    // Header laporan
    worksheet.mergeCells('A1:D1');
    worksheet.mergeCells('A2:D2');
    worksheet.mergeCells('A3:D3');

    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN HUTANG';
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
      const detailRes = await this.hutangdetailService.findAll(
        {
          filters: {
            nobukti: h.nobukti,
          },
        },
        trx,
      );
      const details = detailRes.data ?? [];

      const headerInfo = [
        ['Nomor Bukti', h.nobukti ?? ''],
        ['Tanggal Bukti', h.tglbukti ?? ''],
        ['Tanggal Jatuh Tempo', h.tgljatuhtempo ?? ''],
        ['Keterangan', h.keterangan ?? ''],
        ['Supplier', h.relasi_text ?? ''],
        ['Coa', h.coa_text ?? ''],
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
            d.coa_text ?? '',
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
      `laporan_hutang${Date.now()}.xlsx`,
    );

    await workbook.xlsx.writeFile(tempFilePath);
    return tempFilePath;
  }
}
