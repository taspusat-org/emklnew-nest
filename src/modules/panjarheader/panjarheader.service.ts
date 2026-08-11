import * as fs from 'fs';
import * as path from 'path';
import { Column, Workbook } from 'exceljs';
import { LocksService } from 'src/modules/locks/locks.service';
import { GlobalService } from 'src/modules/global/global.service';
import { RedisService } from 'src/common/redis/redis.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import {
  withUuidV7,
  formatDateToSQL,
  UtilsService,
  calculateItemIndex,
  getFetchedPages,
} from 'src/utils/utils.service';
import { RunningNumberService } from 'src/modules/running-number/running-number.service';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PanjarmuatandetailService } from 'src/modules/panjarmuatandetail/panjarmuatandetail.service';

@Injectable()
export class PanjarheaderService {
  private readonly logger = new Logger(PanjarheaderService.name);
  private readonly tableName: string = 'panjarheader';
  // Baca lewat view, tulis lewat tabel base (lihat create-vpanjar-pg.sql).
  private readonly viewName: string = 'vpanjarheader';
  private readonly detailViewName: string = 'vpanjarmuatandetail';

  // Kolom teks manusiawi — HANYA ini yang boleh di-uppercase. Kode lama
  // meng-uppercase SEMUA field string, termasuk jenisorder_id, biayaemkl_id,
  // statusformat, dan id — semuanya UUID bertipe text alias case-sensitive.
  // Meng-uppercase-nya menulis id yang tidak ada sehingga lookup tampil kosong
  // tanpa satu pun error (lihat catatan yang sama di pengeluaranheader).
  private readonly uppercaseFields = ['keterangan'];

  constructor(
    // Inject wrapper RedisService (BUKAN raw 'REDIS_CLIENT'). Token REDIS_CLIENT
    // memberi instance ioredis mentah dengan enableOfflineQueue:false → saat
    // Redis mati, redisService.set() melempar "Stream isn't writeable" dan
    // menggagalkan create/update (500). Wrapper RedisService membungkus set/get
    // dengan try/catch sehingga cache bersifat best-effort (lanjut tanpa cache).
    private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly panjarmuatandetailService: PanjarmuatandetailService,
  ) {}

  // ─── Session context ───────────────────────────────────────────────────────

  /**
   * Rentang tanggal + jenis orderan dititipkan ke view lewat GUC per-transaksi
   * (set_config(..., is_local = true) → otomatis reset saat transaksi selesai,
   * jadi tidak bocor ke request lain lewat connection pool). '' = tanpa filter.
   *
   * jenisorder_id WAJIB selalu di-set: grid panjar memang selalu dipersempit
   * ke satu jenis orderan, dan default-nya MUATAN — persis perilaku lama yang
   * dulu ditulis sebagai `where u.jenisorder_id = <MUATAN>` di findAll.
   */
  private async setSessionContext(
    trx: any,
    filters: Record<string, any> | undefined,
    { withJenisOrder = true }: { withJenisOrder?: boolean } = {},
  ): Promise<void> {
    const tglDari =
      filters?.tglDari && filters?.tglSampai
        ? formatDateToSQL(String(filters.tglDari))
        : '';
    const tglSampai =
      filters?.tglDari && filters?.tglSampai
        ? formatDateToSQL(String(filters.tglSampai))
        : '';

    await trx.raw(`SELECT set_config('tas.panjar_tgldari', ?, true)`, [
      tglDari ? String(tglDari) : '',
    ]);
    await trx.raw(`SELECT set_config('tas.panjar_tglsampai', ?, true)`, [
      tglSampai ? String(tglSampai) : '',
    ]);

    const jenisOrderId = withJenisOrder
      ? await this.resolveJenisOrderId(trx, filters?.jenisOrderan)
      : '';

    await trx.raw(`SELECT set_config('tas.panjar_jenisorder_id', ?, true)`, [
      jenisOrderId,
    ]);
  }

  /**
   * jenisorder_id kini uuid v7 bertipe text. FilterGrid mengirim id-nya apa
   * adanya; kalau kosong/'null' (halaman baru dibuka, user belum memilih),
   * jatuh ke MUATAN — dicari by nama karena id-nya berbeda per database.
   */
  private async resolveJenisOrderId(trx: any, raw: any): Promise<string> {
    const value = String(raw ?? '').trim();
    if (value && value !== 'null' && value !== 'undefined') return value;

    const muatan = await trx('jenisorder')
      .select('id')
      .where('nama', 'MUATAN')
      .first();

    return muatan?.id ? String(muatan.id) : '';
  }

  // ─── Query dasar ───────────────────────────────────────────────────────────

  /**
   * Query dasar dipakai findAll, COUNT, dan perhitungan posisi baris supaya
   * ketiganya melihat dataset yang PERSIS sama.
   */
  private baseQuery(trx: any) {
    return trx(`${this.viewName} as u`);
  }

  private selectColumns(trx: any) {
    return [
      'u.id',
      'u.nobukti',
      trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
      'u.jenisorder_id',
      'u.biayaemkl_id',
      'u.keterangan',
      'u.modifiedby',
      trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
      trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
      'u.jenisorder_nama',
      'u.biayaemkl_nama',
    ];
  }

  private applyFilters(
    qb: any,
    filters: Record<string, any> | undefined,
    search?: string,
  ): void {
    // tglDari/tglSampai/jenisOrderan sudah jadi predikat di dalam view lewat
    // session context — kalau ikut di-AND-kan di sini, nilainya (mis.
    // '01-12-2025') akan dicocokkan ke kolom bernama sama yang tidak ada.
    const excludeSearchKeys = ['tglDari', 'tglSampai', 'jenisOrderan'];

    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );

    if (search && searchFields.length > 0) {
      const sanitized = String(search).trim();
      qb.where((inner: any) => {
        searchFields.forEach((field) => {
          if (field === 'tglbukti') {
            inner.orWhereRaw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') ilike ?", [
              `%${sanitized}%`,
            ]);
          } else if (field === 'created_at' || field === 'updated_at') {
            inner.orWhereRaw(
              `TO_CHAR(u.${field}, 'DD-MM-YYYY HH24:MI:SS') ilike ?`,
              [`%${sanitized}%`],
            );
          } else if (field === 'jenisorder_text') {
            inner.orWhere('u.jenisorder_nama', 'ilike', `%${sanitized}%`);
          } else if (field === 'biayaemkl_text') {
            inner.orWhere('u.biayaemkl_nama', 'ilike', `%${sanitized}%`);
          } else {
            inner.orWhere(`u.${field}`, 'ilike', `%${sanitized}%`);
          }
        });
      });
    }

    Object.entries(filters || {}).forEach(([key, rawValue]) => {
      if (excludeSearchKeys.includes(key)) return;
      if (rawValue === null || rawValue === undefined || rawValue === '') return;

      const value = String(rawValue);
      if (key === 'tglbukti') {
        qb.andWhereRaw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') ilike ?", [
          `%${value}%`,
        ]);
      } else if (key === 'created_at' || key === 'updated_at') {
        qb.andWhereRaw(`TO_CHAR(u.${key}, 'DD-MM-YYYY HH24:MI:SS') ilike ?`, [
          `%${value}%`,
        ]);
      } else if (key === 'jenisorder_text') {
        qb.andWhere('u.jenisorder_nama', 'ilike', `%${value}%`);
      } else if (key === 'biayaemkl_text') {
        qb.andWhere('u.biayaemkl_nama', 'ilike', `%${value}%`);
      } else {
        qb.andWhere(`u.${key}`, 'ilike', `%${value}%`);
      }
    });
  }

  /**
   * Kolom + arah urut yang dipakai untuk menghitung posisi baris. WAJIB
   * mereplikasi orderBy di findAll(): grid mengurutkan kolom jenis order /
   * biaya emkl memakai TEKS lookup-nya, bukan id UUID-nya. Kalau tidak sama,
   * fokus baris setelah simpan akan meleset.
   */
  private resolvePositionOrder(
    sortBy: string,
    sortDirection: string,
  ): { orderCol: string; dir: 'asc' | 'desc' } {
    const dir = sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
    switch (sortBy) {
      case 'jenisorder_text':
      case 'jenisorder_nama':
        return { orderCol: 'u.jenisorder_nama', dir };
      case 'biayaemkl_text':
      case 'biayaemkl_nama':
        return { orderCol: 'u.biayaemkl_nama', dir };
      default:
        return { orderCol: `u.${sortBy}`, dir };
    }
  }

  /**
   * Posisi (1-based) baris `id` pada dataset yang sedang tampil di grid:
   * jumlah baris yang urutannya <= (asc) / >= (desc) baris tersebut, dengan
   * filter + search yang sama. Nilai pembanding diambil MENTAH dari database
   * (lewat alias `posval`), bukan dari hasil select yang sudah di-TO_CHAR,
   * supaya sort kolom tanggal dibandingkan sebagai tanggal.
   */
  private async resolvePosition(
    trx: any,
    id: string,
    filters: Record<string, any> | undefined,
    search: string | undefined,
    sortBy: string,
    sortDirection: string,
  ): Promise<number> {
    const { orderCol, dir } = this.resolvePositionOrder(sortBy, sortDirection);

    const existingData = await this.baseQuery(trx)
      .select({ posval: orderCol })
      .where('u.id', id)
      .modify((qb: any) => this.applyFilters(qb, filters, search))
      .first();

    // Baris tidak lolos filter aktif (mis. habis diedit jadi tidak cocok) ->
    // jatuhkan fokus ke baris pertama daripada menghitung posisi yang salah.
    if (!existingData || existingData.posval === null) return 1;

    const resultposition = await this.baseQuery(trx)
      .count('* as posisi')
      .where(orderCol, dir === 'desc' ? '>=' : '<=', existingData.posval)
      .modify((qb: any) => this.applyFilters(qb, filters, search))
      .first();

    const posisi = Number(resultposition?.posisi ?? 0);
    return posisi > 0 ? posisi : 1;
  }

  /**
   * Rakit window halaman di sekitar `posisi` lalu balikan datanya per halaman.
   * Satu kali findAll dengan customOffset, dipecah di memory — bukan menarik
   * SELURUH tabel lalu findIndex seperti implementasi lama (`limit: 0`).
   */
  private async buildPagedResult(
    trx: any,
    posisi: number,
    totalItems: number,
    limit: number,
    sortBy: string,
    sortDirection: string,
    filters: Record<string, any> | undefined,
    search: string | undefined,
  ) {
    const pageNumber = Math.ceil(posisi / limit);
    const totalPages = Math.ceil(totalItems / limit);
    const fetchedPages = getFetchedPages(pageNumber, totalPages);

    const startPage = fetchedPages[0];
    const endPage = fetchedPages[fetchedPages.length - 1];
    const customOffset = (startPage - 1) * limit;
    const totalDataNeeded = (endPage - startPage + 1) * limit;

    const result = await this.findAll(
      {
        search: search || '',
        filters: filters || {},
        pagination: { page: startPage, limit: totalDataNeeded, customOffset },
        sort: { sortBy, sortDirection: sortDirection as 'asc' | 'desc' },
        isLookUp: false,
        useCustomOffset: true,
      },
      trx,
    );

    const allFetchedData = result?.data ?? [];
    const pagedData: Record<number, any[]> = {};
    let dataIndex = 0;
    fetchedPages.forEach((pageNum) => {
      pagedData[pageNum] = allFetchedData.slice(dataIndex, dataIndex + limit);
      dataIndex += limit;
    });

    const itemIndex = calculateItemIndex(Number(posisi), fetchedPages, limit);

    await this.redisService.set(
      `${this.tableName}-page-${pageNumber}`,
      JSON.stringify(allFetchedData),
    );

    return {
      itemIndex: itemIndex.zeroBasedIndex < 0 ? 0 : itemIndex.zeroBasedIndex,
      pageNumber,
      fetchedPages,
      pagedData,
    };
  }

  /**
   * Payload detail dibangun EKSPLISIT dari kolom tabel supaya field bantu dari
   * frontend (orderanmuatan_id, isNew, dll) tidak ikut ditulis -> "column does
   * not exist".
   */
  private buildDetailPayload(
    details: any[],
    nobukti: string,
    panjarId: string,
    modifiedby: string,
  ) {
    return details.map((detail: any) => ({
      id: detail.id || 0,
      nobukti,
      panjar_id: panjarId,
      orderanmuatan_nobukti: detail.orderanmuatan_nobukti,
      estimasi: detail.estimasi,
      nominal: detail.nominal,
      keterangan: detail.keterangan || '',
      info: detail.info ?? null,
      modifiedby,
    }));
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async create(data: any, trx: any) {
    try {
      const { sortBy, sortDirection, filters, search, limit } = data;

      const sortColumn = sortBy || 'nobukti';
      const sortDir = sortDirection || 'asc';
      const pageLimit = Number(limit) > 0 ? Number(limit) : 10;

      await this.setSessionContext(trx, filters);

      const created_at = this.utilsService.getTime();
      const updated_at = created_at;
      const formattedTglBukti = formatDateToSQL(String(data?.tglbukti));

      const getFormatPanjarHeader = await trx('parameter')
        .select('id', 'grp', 'subgrp')
        .where('grp', 'NOMOR PANJAR BIAYA')
        .where('kelompok', 'PANJAR BIAYA')
        .first();

      if (!getFormatPanjarHeader) {
        throw new NotFoundException(
          'Parameter NOMOR PANJAR BIAYA tidak ditemukan',
        );
      }

      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        getFormatPanjarHeader.grp,
        getFormatPanjarHeader.subgrp,
        this.tableName,
        String(formattedTglBukti ?? ''),
      );

      const headerData: Record<string, any> = {
        nobukti: nomorBukti,
        tglbukti: formattedTglBukti,
        jenisorder_id: data.jenisorder_id,
        biayaemkl_id: data.biayaemkl_id,
        keterangan: data.keterangan ?? null,
        statusformat: getFormatPanjarHeader.id,
        info: data.info ?? null,
        modifiedby: data.modifiedby,
        created_at,
        updated_at,
      };

      this.uppercaseFields.forEach((field) => {
        if (typeof headerData[field] === 'string') {
          headerData[field] = headerData[field].toUpperCase();
        }
      });

      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, headerData))
        .returning('*');
      const newItem = insertedItems[0];

      if (data.details && data.details.length > 0) {
        await this.panjarmuatandetailService.create(
          this.buildDetailPayload(
            data.details,
            nomorBukti,
            newItem.id,
            newItem.modifiedby,
          ),
          newItem.id,
          trx,
        );
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD PANJAR HEADER',
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      // totalItems SELALU dihitung dengan filter yang sama seperti grid.
      const totalRecords = await this.baseQuery(trx)
        .count('u.id as total')
        .modify((qb: any) => this.applyFilters(qb, filters, search))
        .first();
      const totalItems = Number(totalRecords?.total ?? 0);

      const posisi = await this.resolvePosition(
        trx,
        newItem.id,
        filters,
        search,
        sortColumn,
        sortDir,
      );

      const paged = await this.buildPagedResult(
        trx,
        posisi,
        totalItems,
        pageLimit,
        sortColumn,
        sortDir,
        filters,
        search,
      );

      return { newItem, ...paged };
    } catch (error) {
      console.error('Error creating panjar header in service:', error.message);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error creating panjar header in service',
      );
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

      const sortBy = sort?.sortBy || 'nobukti';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
      const safeFilters = filters || {};

      await this.setSessionContext(trx, safeFilters);

      // Count HARUS memakai filter & search yang sama dengan query data —
      // memakai COUNT tanpa filter (implementasi lama menghitung seluruh isi
      // tabel) membuat totalPages dan posisi baris ikut salah begitu ada filter
      // kolom / search aktif.
      const countResult = await this.baseQuery(trx)
        .count('u.id as total')
        .modify((qb: any) => this.applyFilters(qb, safeFilters, search))
        .first();
      const total = Number(countResult?.total ?? 0);

      if (isLookUp) {
        // Hasil lookup > 500 baris: jangan tarik semuanya, biarkan komponen
        // LookUp beralih ke pencarian server-side.
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
        limit = 0; // <= 500: kirim seluruh baris, difilter di client.
      }

      const query = this.baseQuery(trx).select(this.selectColumns(trx));
      query.modify((qb: any) => this.applyFilters(qb, safeFilters, search));

      const { orderCol } = this.resolvePositionOrder(sortBy, sortDirection);
      query.orderBy(orderCol, sortDirection);
      // Tiebreaker: tanpa urutan total, offset/limit bisa memulangkan baris yang
      // sama di dua halaman berbeda saat grid menggeser window.
      if (orderCol !== 'u.id') {
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
          itemsPerPage: limit > 0 ? limit : total,
        },
      };
    } catch (error) {
      this.logger.error('Error to findAll Panjar Header', error?.stack);
      throw new InternalServerErrorException('Failed to fetch data');
    }
  }

  /**
   * Dipakai export & cetak: header di-JOIN dengan detail sehingga hasilnya
   * BARIS DATAR (satu baris per detail) — bentuk yang sudah diharapkan
   * exportToExcel dan template LaporanPanjar.mrt.
   *
   * Session context di-reset ke kosong lebih dulu: baris yang dicetak bisa saja
   * berada di luar periode/jenis orderan yang sedang aktif di grid, dan filter
   * view tidak boleh menyembunyikannya.
   */
  async findOne(id: string, trx: any) {
    try {
      await this.setSessionContext(trx, undefined, { withJenisOrder: false });

      const data = await trx(`${this.viewName} as u`)
        .select([
          'u.id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.jenisorder_id',
          'u.biayaemkl_id',
          'u.keterangan',
          'u.modifiedby',
          'u.jenisorder_nama as jenisorderan_nama',
          'u.biayaemkl_nama',
          'detail.orderanmuatan_nobukti',
          'detail.estimasi',
          'detail.nominal',
          'detail.keterangan as keterangan_detail',
        ])
        .leftJoin(
          `${this.detailViewName} as detail`,
          'u.id',
          'detail.panjar_id',
        )
        .where('u.id', id)
        .orderBy('detail.created_at', 'asc')
        .orderBy('detail.id', 'asc');

      return {
        data: data,
      };
    } catch (error) {
      console.error('Error fetching data panjar header by id:', error);
      throw new InternalServerErrorException(
        'Failed to fetch data panjar header by id',
      );
    }
  }

  // ─── Export Excel (background job) ─────────────────────────────────────────

  private readonly EXPORT_COLUMNS = [
    'u.nobukti',
    'u.jenisorder_nama',
    'u.biayaemkl_nama',
    'u.keterangan',
    'u.modifiedby',
  ];

  /**
   * jenisorder_id yang dipakai export, hasil resolusi yang SAMA dengan grid
   * (kosong -> MUATAN). Dipanggil controller sekali di depan karena
   * ExportJobService.streamRows bersifat sinkron.
   */
  async resolveExportJenisOrderId(db: any, jenisOrderan: any): Promise<string> {
    return this.resolveJenisOrderId(db, jenisOrderan);
  }

  /**
   * Periode + jenis orderan ditulis EKSPLISIT di sini, TIDAK lewat
   * setSessionContext: set_config(..., true) itu transaction-local, sedangkan
   * export mengalirkan baris lewat cursor di luar transaksi. Tanpa session
   * context kedua guard di view `vpanjarheader` bernilai true sehingga view
   * memulangkan SEMUA periode dan SEMUA jenis orderan — persis kebalikan dari
   * yang tampil di grid. Pola & alasannya sama dengan
   * ShippingInstructionService.buildExportQuery.
   */
  private applyExportScope(
    qb: any,
    filters: Record<string, any> | undefined,
    jenisOrderId: string | undefined,
  ): void {
    if (filters?.tglDari && filters?.tglSampai) {
      qb.whereBetween('u.tglbukti', [
        formatDateToSQL(String(filters.tglDari)),
        formatDateToSQL(String(filters.tglSampai)),
      ]);
    }

    if (jenisOrderId) {
      // uuid v7 bertipe text (case-sensitive) — dibandingkan apa adanya.
      qb.andWhere('u.jenisorder_id', jenisOrderId);
    }
  }

  buildExportQuery(
    {
      search,
      filters,
      sort,
      jenisOrderId,
    }: Pick<FindAllParams, 'search' | 'filters' | 'sort'> & {
      jenisOrderId?: string;
    },
    db: any,
  ) {
    const sortBy = sort?.sortBy || 'nobukti';
    const sortDirection =
      sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';

    const query = db(`${this.viewName} as u`)
      .select([
        ...this.EXPORT_COLUMNS,
        db.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
        db.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
        db.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
      ])
      .modify((qb: any) => this.applyExportScope(qb, filters, jenisOrderId))
      .modify((qb: any) => this.applyFilters(qb, filters, search));

    // Urutan mengikuti grid: kolom jenis order / biaya emkl diurut memakai
    // TEKS lookup-nya, bukan id uuid-nya (lihat resolvePositionOrder).
    const { orderCol } = this.resolvePositionOrder(sortBy, sortDirection);
    query.orderBy(orderCol, sortDirection);
    if (orderCol !== 'u.id') {
      query.orderBy('u.id', 'asc');
    }

    return query;
  }

  /**
   * Jumlah baris yang akan diekspor — dipakai untuk progres export yang
   * sebenarnya.
   */
  async countExportRows(
    {
      search,
      filters,
      jenisOrderId,
    }: Pick<FindAllParams, 'search' | 'filters'> & { jenisOrderId?: string },
    db: any,
  ): Promise<number> {
    const result = await db(`${this.viewName} as u`)
      .count('u.id as total')
      .modify((qb: any) => this.applyExportScope(qb, filters, jenisOrderId))
      .modify((qb: any) => this.applyFilters(qb, filters, search))
      .first();

    return Number(result?.total ?? 0);
  }

  /** Definisi sheet export — kolomnya mengikuti kolom grid header panjar. */
  readonly exportSheet = {
    sheetName: 'Data Export',
    titleLines: [
      'PT. TRANSPORINDO AGUNG SEJAHTERA',
      'LAPORAN PANJAR',
      'Data Export',
    ],
    headers: [
      'NO.',
      'NO BUKTI',
      'TGL BUKTI',
      'JENIS ORDERAN',
      'BIAYA EMKL',
      'KETERANGAN',
      'MODIFIED BY',
      'CREATED AT',
      'UPDATED AT',
    ],
    columnWidths: [5, 25, 15, 20, 30, 30, 20, 22, 22],
    mapRow: (row: any, rowNumber: number) => [
      rowNumber,
      row.nobukti,
      row.tglbukti,
      row.jenisorder_nama,
      row.biayaemkl_nama,
      row.keterangan,
      row.modifiedby,
      row.created_at,
      row.updated_at,
    ],
  };

  async update(id: string, data: any, trx: any) {
    try {
      const existingData = await trx(this.tableName).where('id', id).first();
      if (!existingData) {
        throw new NotFoundException(`Panjar dengan id ${id} tidak ditemukan`);
      }

      const { sortBy, sortDirection, filters, search, limit } = data;

      const sortColumn = sortBy || 'nobukti';
      const sortDir = sortDirection || 'asc';
      const pageLimit = Number(limit) > 0 ? Number(limit) : 10;

      await this.setSessionContext(trx, filters);

      const updated_at = this.utilsService.getTime();
      const nobukti = data.nobukti || existingData.nobukti;

      const headerData: Record<string, any> = {
        nobukti,
        tglbukti: formatDateToSQL(String(data?.tglbukti)),
        jenisorder_id: data.jenisorder_id,
        biayaemkl_id: data.biayaemkl_id,
        keterangan: data.keterangan ?? null,
        info: data.info ?? null,
        modifiedby: data.modifiedby,
        updated_at,
      };

      this.uppercaseFields.forEach((field) => {
        if (typeof headerData[field] === 'string') {
          headerData[field] = headerData[field].toUpperCase();
        }
      });

      const hasChanges = this.utilsService.hasChanges(headerData, existingData);
      if (hasChanges) {
        await trx(this.tableName).where('id', id).update(headerData);
      }

      // Detail selalu di-sinkronkan walau header tidak berubah: user bisa
      // menambah/menghapus baris detail tanpa menyentuh field header.
      // Guard Array.isArray: payload TANPA `details` sama sekali (mis. dipanggil
      // dari tempat lain) tidak boleh diartikan "hapus semua detail" — itu hanya
      // berlaku untuk array kosong yang memang dikirim eksplisit.
      if (Array.isArray(data.details)) {
        await this.panjarmuatandetailService.create(
          this.buildDetailPayload(
            data.details,
            nobukti,
            id,
            headerData.modifiedby,
          ),
          id,
          trx,
        );
      }

      // Ambil baris yang SUDAH diperbarui (tanpa filter kolom) supaya selalu
      // ketemu walau hasil edit tak lagi cocok dengan filter aktif.
      const updatedItem = await this.baseQuery(trx)
        .select(this.selectColumns(trx))
        .where('u.id', id)
        .first();

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT PANJAR HEADER',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(updatedItem),
          modifiedby: headerData.modifiedby,
        },
        trx,
      );

      const totalRecords = await this.baseQuery(trx)
        .count('u.id as total')
        .modify((qb: any) => this.applyFilters(qb, filters, search))
        .first();
      const totalItems = Number(totalRecords?.total ?? 0);

      const posisi = await this.resolvePosition(
        trx,
        id,
        filters,
        search,
        sortColumn,
        sortDir,
      );

      const paged = await this.buildPagedResult(
        trx,
        posisi,
        totalItems,
        pageLimit,
        sortColumn,
        sortDir,
        filters,
        search,
      );

      return { updatedItem, ...paged };
    } catch (error) {
      console.error('Error update panjar header in service:', error.message);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error update panjar header in service',
      );
    }
  }

  async delete(id: string, trx: any, modifiedby: any) {
    try {
      const checkDataDetail = await trx('panjarmuatandetail')
        .select('id')
        .where('panjar_id', id);

      if (checkDataDetail && checkDataDetail.length > 0) {
        for (const detail of checkDataDetail) {
          await this.panjarmuatandetailService.delete(
            detail.id,
            trx,
            modifiedby,
          );
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
          postingdari: 'DELETE PANJAR HEADER',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: String(modifiedby ?? '').toUpperCase(),
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
    const dataHeader = data.data[0];
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:E1');
    worksheet.mergeCells('A2:E2');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN PANJAR';

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

    worksheet.getCell('C5').value = dataHeader.nobukti;
    worksheet.getCell('C6').value = dataHeader.tglbukti;
    worksheet.getCell('C7').value = dataHeader.jenisorderan_nama;
    worksheet.getCell('C8').value = dataHeader.biayaemkl_nama;
    worksheet.getCell('C9').value = dataHeader.keterangan;

    const headers = [
      'NO.',
      'NO BUKTI ORDERAN',
      'ESTIMASI',
      'NOMINAL',
      'KETERANGAN',
    ];

    headers.forEach((header, index) => {
      const cell = worksheet.getCell(11, index + 1);
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

    data.data.forEach((row, rowIndex) => {
      const currentRow = rowIndex + 12;
      const rowValues = [
        rowIndex + 1,
        row.orderanmuatan_nobukti,
        row.estimasi,
        row.nominal,
        row.keterangan_detail,
      ];

      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);

        cell.value = value ?? '';
        cell.font = { name: 'Tahoma', size: 10 };

        if (colIndex === 2 || colIndex === 3) {
          cell.value = Number(value ?? 0);
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
      `laporan_panjar_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
