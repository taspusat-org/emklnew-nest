import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  FindAllParams,
  WriteOptions,
} from 'src/common/interfaces/all.interface';
import { RedisService } from 'src/common/redis/redis.service';
import {
  formatDateToSQL,
  UtilsService,
  calculateItemIndex,
  getFetchedPages,
  uuidV7,
} from 'src/utils/utils.service';
import { numberToTerbilang } from 'src/utils/terbilang';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { PengembaliankasgantungdetailService } from '../pengembaliankasgantungdetail/pengembaliankasgantungdetail.service';
import { PenerimaanheaderService } from '../penerimaanheader/penerimaanheader.service';
import { PenerimaandetailService } from '../penerimaandetail/penerimaandetail.service';
import { GlobalService } from '../global/global.service';
import { LocksService } from '../locks/locks.service';
import {
  EXCEL_FORMAT,
  ExportSheetDefinition,
} from 'src/common/report/export-job.service';

@Injectable()
export class PengembaliankasgantungheaderService {
  private readonly logger = new Logger(
    PengembaliankasgantungheaderService.name,
  );

  constructor(
    // Inject wrapper RedisService (BUKAN raw 'REDIS_CLIENT'): set/get/del cache
    // jadi best-effort sehingga create/update tidak gagal 500 "Stream isn't
    // writeable" saat Redis mati. Lihat pengeluaranheader.service.ts.
    private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly pengembaliankasgantungdetailService: PengembaliankasgantungdetailService,
    private readonly penerimaanheaderService: PenerimaanheaderService,
    private readonly penerimaandetailService: PenerimaandetailService,
    private readonly globalService: GlobalService,
    private readonly locksService: LocksService,
  ) {}

  private readonly tableName = 'pengembaliankasgantungheader';
  private readonly viewName = 'vpengembaliankasgantungheader';

  private readonly dateFields = ['tglbukti', 'created_at', 'updated_at'];

  /** Kolom teks manusiawi yang di-uppercase; sisanya identifier, jangan disentuh. */
  private readonly uppercaseFields = ['nobukti', 'keterangan'];

  private buildInsertData(
    uuid: string | undefined,
    dto: any,
  ): Record<string, any> {
    return {
      id: uuid ? uuid : dto.id ? String(dto.id) : null,
      nobukti: dto.nobukti ? String(dto.nobukti).toUpperCase() : null,
      tglbukti: dto.tglbukti ? formatDateToSQL(String(dto.tglbukti)) : null,
      keterangan: dto.keterangan ? String(dto.keterangan).toUpperCase() : null,
      bank_id: dto.bank_id ?? null,
      penerimaan_nobukti: dto.penerimaan_nobukti ?? null,
      coakasmasuk: dto.coakasmasuk ?? null,
      relasi_id: dto.relasi_id ?? null,
      alatbayar_id: dto.alatbayar_id ?? null,
      statusformat: dto.statusformat ?? null,
      info: dto.info ?? null,
      modifiedby: dto.modifiedby ? String(dto.modifiedby).toUpperCase() : null,
      created_at: dto.created_at || this.utilsService.getTime(),
      updated_at: dto.updated_at || this.utilsService.getTime(),
    };
  }

  /**
   * Rentang tanggal dan bank disaring DI DALAM
   * vpengembaliankasgantungheader lewat `tas.pengembaliankasgantung_*`, bukan
   * whereBetween di query luar: view memangkas header sebelum LEFT JOIN
   * relasi/bank/akunpusat/alatbayar.
   *
   * Nilai kosong dikirim EKSPLISIT (bukan sekadar dilewati) supaya sisa GUC
   * dari request sebelumnya di koneksi yang sama tidak ikut memangkas.
   *
   * Namanya ber-prefix `pengembaliankasgantung_` karena create/update di modul
   * ini memanggil PenerimaanheaderService di transaksi yang SAMA, dan
   * penerimaan memakai `tas.tgldari`/`tas.tglsampai`/`tas.bank_id` untuk
   * gridnya sendiri.
   *
   * `set_config(..., true)` hanya hidup selama transaksi; jalur tanpa trx
   * (report/export) menyaring per id/nobukti sendiri, jadi tidak terpengaruh.
   */
  private async setPeriodSessionContext(
    trx: any,
    filters?: Record<string, any>,
  ): Promise<void> {
    const tglDari = filters?.tglDari
      ? formatDateToSQL(String(filters.tglDari))
      : null;
    const tglSampai = filters?.tglSampai
      ? formatDateToSQL(String(filters.tglSampai))
      : null;

    await trx.raw(
      `SELECT set_config('tas.pengembaliankasgantung_tgldari', ?, true),
              set_config('tas.pengembaliankasgantung_tglsampai', ?, true),
              set_config('tas.pengembaliankasgantung_bank_id', ?, true)`,
      [
        tglDari ?? '',
        tglSampai ?? '',
        filters?.bank_id ? String(filters.bank_id) : '',
      ],
    );
  }

  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    // tglDari/tglSampai/bank_id sudah diturunkan ke view lewat GUC; ikut
    // disapu SEARCH hanya akan menghasilkan predikat ganda yang salah.
    const excludeSearchKeys = ['tglDari', 'tglSampai', 'bank_id'];

    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );

    if (search && searchFields.length > 0) {
      const sanitized = String(search).trim();
      qb.where((query: any) => {
        searchFields.forEach((field) => {
          if (this.dateFields.includes(field)) {
            query.orWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
              field,
              `%${sanitized}%`,
            ]);
          } else {
            query.orWhere(`u.${field}`, 'ilike', `%${sanitized}%`);
          }
        });
      });
    }

    Object.entries(filters || {}).forEach(([key, rawValue]) => {
      if (excludeSearchKeys.includes(key)) return;
      if (rawValue === null || rawValue === undefined || rawValue === '')
        return;

      const sanitizedValue = String(rawValue);
      if (this.dateFields.includes(key)) {
        qb.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else {
        qb.andWhere(`u.${key}`, 'ilike', `%${sanitizedValue}%`);
      }
    });
  }

  private resolvePositionOrder(
    sortBy: string,
    sortDirection: string,
  ): { orderCol: string; dir: 'asc' | 'desc' } {
    const dir = sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
    // Tanpa fallback, create/update yang dipanggil bersarang (payloadnya
    // tidak membawa sortBy) menghasilkan kolom 'u.undefined'.
    return { orderCol: `u.${sortBy || 'nobukti'}`, dir };
  }

  private async resolvePosition(
    trx: any,
    id: string,
    filters: Record<string, any>,
    search: string | undefined,
    sortBy: string,
    sortDirection: string,
  ): Promise<number> {
    const { orderCol, dir } = this.resolvePositionOrder(sortBy, sortDirection);

    const existingData = await trx(`${this.viewName} as u`)
      .select({ posval: orderCol })
      .where('u.id', id)
      .modify((qb: any) => this.applyFilters(qb, filters, search))
      .first();
    if (!existingData || existingData.posval === null) return 1;

    const resultposition = await trx(`${this.viewName} as u`)
      .count('* as posisi')
      .where(orderCol, dir === 'desc' ? '>=' : '<=', existingData.posval)
      .modify((qb: any) => this.applyFilters(qb, filters, search))
      .first();

    const posisi = Number(resultposition?.posisi ?? 0);
    return posisi > 0 ? posisi : 1;
  }

  private viewColumns(trx: any) {
    return [
      'u.id',
      'u.nobukti',
      trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
      'u.keterangan',
      'u.bank_id',
      'u.penerimaan_nobukti',
      'u.coakasmasuk',
      'u.relasi_id',
      'u.alatbayar_id',
      'u.statusformat',
      'u.info',
      'u.modifiedby',
      trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
      trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
      'u.relasi_text',
      'u.bank_text',
      'u.coakasmasuk_text',
      'u.alatbayar_text',
      'u.link',
    ];
  }

  private async buildPagedResult(
    trx: any,
    posisi: number,
    totalItems: number,
    limit: number,
    sortBy: string,
    sortDirection: string,
    filters: Record<string, any>,
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
   * Format penerimaan gantung + parameternya, diturunkan dari bank yang dipilih.
   * Dipakai create() untuk menomori bukti dan update() untuk mengetahui coa
   * lawan yang dipakai rincian penerimaannya.
   */
  private async resolveFormatPenerimaanGantung(trx: any, bankId: any) {
    const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)'; // penting: TEXT/NTEXT -> text

    const format = await trx('bank as b')
      .select('p.grp', 'p.subgrp', 'b.formatpenerimaangantung', 'b.coa')
      .leftJoin('parameter as p', 'p.id', 'b.formatpenerimaangantung')
      .where('b.id', bankId)
      .first();

    if (!format?.formatpenerimaangantung) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'FORMAT PENERIMAAN GANTUNG UNTUK BANK INI BELUM DIATUR',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const parameter = await trx('parameter')
      .select(
        'grp',
        'subgrp',
        trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
        trx.raw(`JSON_VALUE(${memoExpr}, '$.COA') AS coa_nama`),
      )
      .where('id', format.formatpenerimaangantung)
      .first();

    if (!parameter) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'PARAMETER FORMAT PENERIMAAN GANTUNG TIDAK DITEMUKAN',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return { format, parameter };
  }

  /**
   * Rincian yang dikirim grid berasal dari lookup KAS GANTUNG, jadi `id`-nya
   * adalah id kas gantung — bukan id pengembaliankasgantungdetail. Id detail
   * yang sebenarnya (berikut tautannya ke penerimaandetail) dipulihkan dengan
   * mencocokkan nomor bukti kas gantungnya.
   */
  private async mapExistingDetails(trx: any, headerId: string) {
    const rows = await trx('pengembaliankasgantungdetail')
      .select('id', 'kasgantung_nobukti', 'penerimaandetail_id')
      .where('pengembaliankasgantung_id', headerId);

    return new Map<string, any>(
      rows.map((row: any) => [String(row.kasgantung_nobukti), row]),
    );
  }

  async create(data: any, trx: any, options: WriteOptions = {}) {
    const { withGridPosition = true } = options;
    try {
      // 1. Pisahkan properti non-insert (pagination, search, kolom tampilan)
      //    dari payload utama.
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
        coakasmasuk_nama,
        alatbayar_nama,
        relasi_text,
        bank_text,
        coakasmasuk_text,
        alatbayar_text,
        link,
        details,
        ...dto
      } = data;

      if (!details || details.length === 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Detail pengembalian kas gantung tidak boleh kosong',
            error: 'Bad Request',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const uuid = await uuidV7(trx);
      dto.tglbukti = formatDateToSQL(String(dto?.tglbukti));

      // 2. Format penerimaan gantung + cabang untuk penomoran bukti.
      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
      const parameterCabang = await trx('parameter')
        .select(trx.raw(`JSON_VALUE(${memoExpr}, '$.CABANG_ID') AS cabang_id`))
        .where('grp', 'CABANG')
        .andWhere('subgrp', 'CABANG')
        .first();

      const { format, parameter } = await this.resolveFormatPenerimaanGantung(
        trx,
        dto.bank_id,
      );

      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        format.grp,
        format.subgrp,
        this.tableName,
        dto.tglbukti,
        parameterCabang?.cabang_id,
      );
      dto.nobukti = nomorBukti;
      dto.statusformat = format.formatpenerimaangantung;

      // 3. Bukti penerimaan pasangannya dibuat lebih dulu supaya nomornya bisa
      //    disimpan di header ini. withGridPosition dimatikan: grid penerimaan
      //    tidak sedang menunggu hasil simpan ini.
      const insertPenerimaan = await this.penerimaanheaderService.create(
        {
          tglbukti: dto.tglbukti,
          keterangan: dto.keterangan,
          bank_id: dto.bank_id,
          relasi_id: dto.relasi_id,
          alatbayar_id: dto.alatbayar_id,
          postingdari: parameter.memo_nama,
          coakasmasuk: dto.coakasmasuk,
          modifiedby: data.modifiedby,
          details: details.map((detail: any) => ({
            ...detail,
            id: '0',
            coa: parameter.coa_nama,
            pengembaliankasgantung_nobukti: nomorBukti,
            modifiedby: data.modifiedby,
          })),
        },
        trx,
        { withGridPosition: false },
      );
      dto.penerimaan_nobukti = insertPenerimaan.newItem.nobukti;

      // 4. INSERT HEADER. insertPayload sudah membawa uuid dari langkah 1;
      //    membungkusnya lagi dengan withUuidV7 akan menimpanya dengan uuid
      //    baru, sehingga id yang dipakai menghitung posisi grid di bawah bukan
      //    id yang benar-benar tersimpan.
      const insertPayload = this.buildInsertData(uuid, dto);
      const insertedItems = await trx(this.tableName)
        .insert(insertPayload)
        .returning('*');
      const newItem = insertedItems[0];

      // 5. INSERT DETAIL. `detail.nobukti` yang dikirim grid adalah nomor bukti
      //    KAS GANTUNG-nya, jadi dipindahkan ke kasgantung_nobukti dan nobukti
      //    diisi nomor bukti pengembalian ini.
      const penerimaanDetailRows = insertPenerimaan.dataDetail?.data ?? [];
      const detailsWithNobukti = details.map((detail: any, index: number) => ({
        id: '0',
        nobukti: nomorBukti,
        kasgantung_nobukti: detail.kasgantung_nobukti ?? detail.nobukti,
        keterangan: detail.keterangan ?? null,
        nominal: detail.nominal ?? null,
        info: detail.info ?? null,
        modifiedby: data.modifiedby,
        penerimaandetail_id: penerimaanDetailRows[index]?.id ?? null,
      }));
      await this.pengembaliankasgantungdetailService.create(
        detailsWithNobukti,
        newItem.id,
        trx,
      );

      // 6. Posisi/pagination hanya dipakai grid pengembalian kas gantung untuk
      //    memfokuskan baris baru. Pemanggilan bersarang mematikannya lewat
      //    withGridPosition. Tetap dibungkus try/catch: header + detail sudah
      //    tersimpan, jadi gagal menghitung posisi tidak boleh me-rollback
      //    simpan yang berhasil.
      let paged: Awaited<ReturnType<typeof this.buildPagedResult>> = {
        itemIndex: 0,
        pageNumber: 1,
        fetchedPages: [1],
        pagedData: {},
      };
      if (withGridPosition) {
        try {
          await this.setPeriodSessionContext(trx, filters);

          const totalRecords = await trx(`${this.viewName} as u`)
            .count('u.id as total')
            .modify((qb: any) => this.applyFilters(qb, filters, search))
            .first();
          const totalItems = Number(totalRecords?.total ?? 0);

          const posisi = await this.resolvePosition(
            trx,
            newItem.id,
            filters,
            search,
            sortBy,
            sortDirection,
          );

          paged = await this.buildPagedResult(
            trx,
            posisi,
            totalItems,
            Number(limit) > 0 ? Number(limit) : 10,
            sortBy,
            sortDirection,
            filters,
            search,
          );
        } catch (error) {
          this.logger.warn(
            `Gagal menghitung posisi grid pengembalian kas gantung: ${error?.message}`,
          );
        }
      }

      const dataDetail = await this.pengembaliankasgantungdetailService.findAll(
        { filters: { nobukti: newItem.nobukti } },
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD PENGEMBALIAN KAS GANTUNG HEADER',
          idtrans: newItem.id,
          nobuktitrans: newItem.nobukti,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      return { newItem, ...paged, dataDetail };
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

      await this.setPeriodSessionContext(trx, safeFilters);

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

      const query = trx(`${this.viewName} as u`).select(this.viewColumns(trx));
      query.modify((qb: any) => this.applyFilters(qb, safeFilters, search));

      const { orderCol } = this.resolvePositionOrder(sortBy, sortDirection);
      query.orderBy(orderCol, sortDirection);
      // Urutan HARUS deterministik: tanpa tiebreaker, offset/limit bisa
      // memulangkan baris yang sama di dua halaman berbeda saat grid menggeser
      // window.
      if (sortBy !== 'id') {
        query.orderBy('u.id', 'asc');
      }

      // buildPagedResult mengambil BEBERAPA halaman sekaligus (limit =
      // totalDataNeeded) tapi offsetnya harus tetap dihitung per ukuran halaman.
      // Tanpa cabang customOffset, offset jadi (startPage-1)*totalDataNeeded —
      // melewati akhir data begitu startPage > 1, dan window pasca-simpan pulang
      // kosong.
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
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async findOne(id: string, trx: any) {
    try {
      const data = await trx(`${this.viewName} as u`)
        .select(this.viewColumns(trx))
        .where('u.id', id);

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
        coakasmasuk_nama,
        alatbayar_nama,
        relasi_text,
        bank_text,
        coakasmasuk_text,
        alatbayar_text,
        link,
        details,
        // Kolom turunan: nobukti dari running number, penerimaan_nobukti &
        // statusformat dari format penerimaan gantung. Form mengirimnya balik
        // sebagai read-only, dan kalau ikut di-UPDATE satu payload yang tidak
        // membawanya akan MENGOSONGKAN tautan ke bukti penerimaannya.
        nobukti,
        penerimaan_nobukti,
        statusformat,
        ...insertData
      } = data;

      if (!details || details.length === 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Detail pengembalian kas gantung tidak boleh kosong',
            error: 'Bad Request',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      insertData.tglbukti = formatDateToSQL(String(data?.tglbukti));

      // Uppercase HANYA kolom teks manusiawi. Sisanya (id, *_id, status*, dan
      // kolom FK lain) adalah identifier: mayoritas id master kini uuid v7
      // HURUF KECIL, jadi blanket uppercase menulis id yang tidak ada. Tanpa
      // FK, Postgres menerimanya diam-diam sehingga lookup tampil kosong dan
      // perubahan terlihat "tidak tersimpan".
      this.uppercaseFields.forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      const existingData = await trx(this.tableName).where('id', id).first();
      if (!existingData) {
        throw new NotFoundException(
          `Pengembalian kas gantung dengan id ${id} tidak ditemukan`,
        );
      }

      const { parameter } = await this.resolveFormatPenerimaanGantung(
        trx,
        insertData.bank_id,
      );

      const hasChanges = this.utilsService.hasChanges(insertData, existingData);
      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(insertData);
      }

      // Id detail yang sebenarnya dipulihkan lewat nomor bukti kas gantungnya —
      // grid mengirim id baris lookup kas gantung, bukan id detail.
      const existingByKasgantung = await this.mapExistingDetails(trx, id);
      const resolveKasgantungNobukti = (detail: any) =>
        String(detail.kasgantung_nobukti ?? detail.nobukti ?? '');

      // Rincian penerimaan pasangannya: baris lama memakai id penerimaandetail
      // yang sudah tercatat, baris baru dikirim sebagai '0'.
      const penerimaanData = await trx('penerimaanheader')
        .where('nobukti', existingData.penerimaan_nobukti)
        .first();

      if (penerimaanData) {
        const detailPenerimaan = details.map((detail: any) => {
          const existing = existingByKasgantung.get(
            resolveKasgantungNobukti(detail),
          );

          return {
            id: existing?.penerimaandetail_id ?? '0',
            penerimaandetail_id: existing?.penerimaandetail_id ?? '0',
            coa: parameter.coa_nama,
            keterangan: detail.keterangan ?? null,
            nominal: detail.nominal ?? null,
            info: detail.info ?? null,
            pengembaliankasgantung_nobukti: existingData.nobukti,
            modifiedby: data.modifiedby,
          };
        });

        await this.penerimaanheaderService.update(
          penerimaanData.id,
          {
            // Ikut tanggal HASIL EDIT, bukan tanggal lama: penerimaan dan
            // jurnal umum yang dibangun darinya harus setanggal dengan bukti
            // pengembaliannya.
            tglbukti: insertData.tglbukti,
            keterangan: insertData.keterangan,
            relasi_id: insertData.relasi_id,
            bank_id: insertData.bank_id,
            alatbayar_id: insertData.alatbayar_id,
            coakasmasuk: insertData.coakasmasuk,
            // Penanda bagi PenerimaanheaderService bahwa id rincian dikirim
            // lewat `penerimaandetail_id` (alur pengembalian kas gantung).
            penerimaan_nobukti: existingData.penerimaan_nobukti,
            modifiedby: data.modifiedby,
            details: detailPenerimaan,
          },
          trx,
          { withGridPosition: false },
        );
      }

      // Baris penerimaan yang baru saja dibuat belum punya id saat payload di
      // atas disusun, jadi tautannya dipulihkan dari kondisi terkini: id lama
      // dipertahankan, sisanya dibagikan berurutan ke baris baru.
      const penerimaanDetailRows = penerimaanData
        ? ((
            await this.penerimaandetailService.findAll(
              {
                filters: {
                  nobukti: penerimaanData.nobukti,
                  pengembaliankasgantung_nobukti: existingData.nobukti,
                },
              },
              trx,
            )
          ).data ?? [])
        : [];
      const claimedPenerimaanDetailIds = new Set(
        [...existingByKasgantung.values()]
          .map((row: any) => row.penerimaandetail_id)
          .filter(Boolean)
          .map(String),
      );
      const unclaimedPenerimaanDetailIds = penerimaanDetailRows
        .map((row: any) => String(row.id))
        .filter((rowId: string) => !claimedPenerimaanDetailIds.has(rowId));

      let unclaimedIndex = 0;
      const detailsWithNobukti = details.map((detail: any) => {
        const kasgantungNobukti = resolveKasgantungNobukti(detail);
        const existing = existingByKasgantung.get(kasgantungNobukti);

        return {
          id: existing?.id ?? '0',
          nobukti: existingData.nobukti,
          kasgantung_nobukti: kasgantungNobukti,
          keterangan: detail.keterangan ?? null,
          nominal: detail.nominal ?? null,
          info: detail.info ?? null,
          modifiedby: data.modifiedby,
          penerimaandetail_id:
            existing?.penerimaandetail_id ??
            unclaimedPenerimaanDetailIds[unclaimedIndex++] ??
            null,
        };
      });
      await this.pengembaliankasgantungdetailService.create(
        detailsWithNobukti,
        id,
        trx,
      );

      // Ambil baris yang SUDAH diperbarui (tanpa filter) supaya selalu ketemu
      // walau hasil edit tak lagi cocok dengan filter aktif.
      const updatedItem = await trx(`${this.viewName} as u`)
        .select(this.viewColumns(trx))
        .where('u.id', id)
        .first();

      // ── Posisi/pagination pasca-simpan (NON-FATAL) ───────────────────────
      // Header + detail SUDAH ter-update di atas. Blok di bawah hanya
      // menghitung posisi baris di grid; kegagalannya tidak boleh
      // menggagalkan simpan yang sudah berhasil.
      const sortColumn = sortBy || 'nobukti';
      const sortDir = sortDirection || 'asc';
      const pageLimit = Number(limit) > 0 ? Number(limit) : 10;

      let paged: Awaited<ReturnType<typeof this.buildPagedResult>> = {
        itemIndex: 0,
        pageNumber: 1,
        fetchedPages: [1],
        pagedData: {},
      };

      if (withGridPosition) {
        try {
          await this.setPeriodSessionContext(trx, filters);

          const totalRecords = await trx(`${this.viewName} as u`)
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

          paged = await this.buildPagedResult(
            trx,
            posisi,
            totalItems,
            pageLimit,
            sortColumn,
            sortDir,
            filters,
            search,
          );
        } catch (error) {
          this.logger.warn(
            `Update pengembaliankasgantungheader ${id} berhasil, tetapi posisi grid pasca-simpan gagal dihitung: ${error?.message}`,
          );
        }
      }

      const dataDetail = await this.pengembaliankasgantungdetailService.findAll(
        { filters: { nobukti: existingData.nobukti } },
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT PENGEMBALIAN KAS GANTUNG HEADER',
          idtrans: id,
          nobuktitrans: existingData.nobukti,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      return { updatedItem, ...paged, dataDetail };
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

  async delete(id: string, trx: any, modifiedby: string) {
    try {
      // Detail dihapus lebih dulu: header dipegang
      // pengembaliankasgantungdetail.pengembaliankasgantung_id.
      const deletedDataDetail = await this.utilsService.lockAndDestroy(
        id,
        'pengembaliankasgantungdetail',
        'pengembaliankasgantung_id',
        trx,
      );

      const deletedData = await this.utilsService.lockAndDestroy(
        id,
        this.tableName,
        'id',
        trx,
      );

      if (deletedDataDetail) {
        await this.logTrailService.create(
          {
            namatabel: 'pengembaliankasgantungdetail',
            postingdari: 'DELETE PENGEMBALIAN KAS GANTUNG DETAIL',
            idtrans: deletedDataDetail.id,
            nobuktitrans: deletedDataDetail.nobukti,
            aksi: 'DELETE',
            datajson: JSON.stringify(deletedDataDetail),
            modifiedby: modifiedby,
          },
          trx,
        );
      }

      if (deletedData) {
        await this.logTrailService.create(
          {
            namatabel: this.tableName,
            postingdari: 'DELETE PENGEMBALIAN KAS GANTUNG HEADER',
            idtrans: deletedData.id,
            nobuktitrans: deletedData.nobukti,
            aksi: 'DELETE',
            datajson: JSON.stringify(deletedData),
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

  /**
   * Data untuk cetak bukti pengembalian kas gantung di background: satu header
   * beserta rinciannya, dipetakan ke dua datasource
   * LaporanPengembalianKasGantung.mrt — `data` (header) dan `detail` (rincian
   * kas gantung/nominal).
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

    const detailRes = await this.pengembaliankasgantungdetailService.findAll(
      { filters: { nobukti: header.nobukti } },
      db,
    );
    const details = detailRes.data ?? [];

    // Dijumlahkan dalam satuan sen lalu dibagi 100: menjumlah float rupiah
    // langsung meninggalkan sisa pembulatan yang membuat "terbilang" meleset
    // satu rupiah dari Sum(detail.nominal) yang dicetak template.
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
          relasi_nama: header.relasi_text,
          bank_nama: header.bank_text,
          alatbayar_nama: header.alatbayar_text,
          judullaporan: judullaporan ?? 'Laporan Pengembalian Kas Gantung',
          usercetak: username,
          tglcetak,
          terbilang: numberToTerbilang(totalNominal),
          judul: 'PT.TRANSPORINDO AGUNG SEJAHTERA',
        },
      ],
      detail: details,
    };
  }

  /**
   * Data master satu bukti untuk blok info di atas tabel rincian. Dipakai juga
   * untuk memberi nama file, jadi diambil SEBELUM job export dimulai supaya
   * id yang tidak ada langsung balas 404, bukan gagal di tengah job.
   */
  async loadExportBuktiHeader(id: string, db: any) {
    const header = await db(`${this.viewName} as u`)
      .select([
        'u.nobukti',
        db.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
        'u.keterangan',
        'u.penerimaan_nobukti',
        'u.relasi_text',
        'u.bank_text',
        'u.coakasmasuk_text',
      ])
      .where('u.id', String(id))
      .first();

    if (!header) {
      throw new NotFoundException(
        `Pengembalian kas gantung dengan id ${id} tidak ditemukan`,
      );
    }

    return header;
  }

  /**
   * Rincian satu bukti, urut sesuai urutan input. Dikembalikan sebagai query
   * (bukan array) supaya ExportJobService bisa men-stream-nya lewat cursor.
   */
  buildExportBuktiQuery(nobukti: string, db: any) {
    return db('vpengembaliankasgantungdetail as d')
      .select([
        'd.nobukti',
        'd.kasgantung_nobukti',
        db.raw(
          "TO_CHAR(d.kasgantung_tglbukti, 'DD-MM-YYYY') as kasgantung_tglbukti",
        ),
        'd.keterangan',
        'd.nominal',
      ])
      .where('d.nobukti', nobukti)
      .orderBy('d.created_at', 'asc')
      .orderBy('d.id', 'asc');
  }

  /** Jumlah baris rincian — dipakai untuk progres export yang nyata. */
  async countExportBuktiRows(nobukti: string, db: any): Promise<number> {
    const result = await db('vpengembaliankasgantungdetail as d')
      .count('d.id as total')
      .where('d.nobukti', nobukti)
      .first();

    return Number(result?.total ?? 0);
  }

  /** Sheet export per transaksi: blok master di atas, rincian + TOTAL di bawah. */
  buildExportBuktiSheet(header: any): ExportSheetDefinition {
    return {
      sheetName: 'Pengembalian Kas Gantung',
      titleLines: [
        'PT. TRANSPORINDO AGUNG SEJAHTERA',
        'LAPORAN PENGEMBALIAN KAS GANTUNG',
        String(header.nobukti ?? ''),
      ],
      infoLines: [
        { label: 'NO BUKTI', value: header.nobukti },
        { label: 'TGL BUKTI', value: header.tglbukti },
        { label: 'KETERANGAN', value: header.keterangan },
        { label: 'RELASI', value: header.relasi_text },
        { label: 'BANK / KAS', value: header.bank_text },
        { label: 'COA KAS MASUK', value: header.coakasmasuk_text },
        { label: 'NO BUKTI PENERIMAAN', value: header.penerimaan_nobukti },
      ],
      headers: [
        'NO.',
        'NO BUKTI',
        'NO BUKTI KAS GANTUNG',
        'TGL BUKTI KAS GANTUNG',
        'KETERANGAN',
        'NOMINAL',
      ],
      columnFormats: [
        null,
        null,
        null,
        null,
        null,
        { numFmt: EXCEL_FORMAT.RUPIAH_DESIMAL },
      ],
      totalRow: { sumColumns: [5] },
      mapRow: (row: any, rowNumber: number) => [
        rowNumber,
        row.nobukti,
        row.kasgantung_nobukti,
        row.kasgantung_tglbukti,
        row.keterangan,
        row.nominal,
      ],
    };
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
