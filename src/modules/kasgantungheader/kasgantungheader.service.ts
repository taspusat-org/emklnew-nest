import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { RedisService } from 'src/common/redis/redis.service';
import {
  formatDateToSQL,
  UtilsService,
  calculateItemIndex,
  getFetchedPages,
  uuidV7,
  tandatanya,
} from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { KasgantungdetailService } from '../kasgantungdetail/kasgantungdetail.service';
import { PengeluaranheaderService } from '../pengeluaranheader/pengeluaranheader.service';
import { GlobalService } from '../global/global.service';
import { LocksService } from '../locks/locks.service';
import { StatuspendukungService } from '../statuspendukung/statuspendukung.service';
import { numberToTerbilang } from 'src/utils/terbilang';
import {
  EXCEL_FORMAT,
  ExportSheetDefinition,
} from 'src/common/report/export-job.service';
import { Column, Workbook } from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class KasgantungheaderService {
  constructor(
    // Inject wrapper RedisService (BUKAN raw 'REDIS_CLIENT'): set/get/del cache
    // jadi best-effort sehingga create/update tidak gagal 500 "Stream isn't
    // writeable" saat Redis mati. Lihat pengeluaranheader.service.ts.
    private readonly redisService: RedisService,
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
  private readonly viewName = 'vkasgantungheader';

  private readonly dateFields = [
    'tglbukti',
    'tgljatuhtempo',
    'created_at',
    'updated_at',
  ];

  // Kolom yang ikut disapu kotak SEARCH di grid = kolom yang tampil di grid.
  private static readonly SEARCHABLE_COLUMNS = [
    'nobukti',
    'tglbukti',
    'keterangan',
    'relasi_nama',
    'bank_nama',
    'alatbayar_nama',
    'pengeluaran_nobukti',
    'coakaskeluar',
    'dibayarke',
    'nowarkat',
    'tgljatuhtempo',
    'gantungorderan_nobukti',
    'modifiedby',
    'created_at',
    'updated_at',
  ];

  // Key di luar daftar ini bukan kolom tabel/join (mis. `nominal` dan `sisa`
  // yang ikut dikirim state filter frontend) dan akan membuat query gagal
  // kalau diteruskan apa adanya.
  private static readonly FILTERABLE_COLUMNS = new Set([
    ...KasgantungheaderService.SEARCHABLE_COLUMNS,
    'relasi_id',
    'bank_id',
    'alatbayar_id',
    'statusformat',
    'info',
  ]);

  // relasi_nama/bank_nama/alatbayar_nama sudah ikut di vkasgantungheader, jadi
  // semua kolom grid diacu lewat alias view yang sama.
  private columnRef(key: string): string {
    return `u.${key}`;
  }

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
  }

  private baseQuery(trx: any) {
    return trx(`${this.viewName} as u`);
  }

  private buildInsertData(
    uuid: string | undefined,
    dto: any,
  ): Record<string, any> {
    return {
      // id TIDAK di-uppercase: uuid v7 huruf kecil, mengubahnya menulis id
      // yang tidak pernah ada.
      id: uuid ? uuid : dto.id ? String(dto.id) : null,
      nobukti: dto.nobukti ? String(dto.nobukti).toUpperCase() : '',
      tglbukti: dto.tglbukti ? formatDateToSQL(String(dto.tglbukti)) : null,
      keterangan: dto.keterangan ? String(dto.keterangan).toUpperCase() : null,
      relasi_id: dto.relasi_id ?? null,
      bank_id: dto.bank_id ?? null,
      alatbayar_id: dto.alatbayar_id ?? null,
      pengeluaran_nobukti: dto.pengeluaran_nobukti
        ? String(dto.pengeluaran_nobukti).toUpperCase()
        : null,
      coakaskeluar: dto.coakaskeluar ?? null,
      dibayarke: dto.dibayarke ? String(dto.dibayarke).toUpperCase() : null,
      nowarkat: dto.nowarkat ? String(dto.nowarkat).toUpperCase() : null,
      tgljatuhtempo: dto.tgljatuhtempo
        ? formatDateToSQL(String(dto.tgljatuhtempo))
        : null,
      gantungorderan_nobukti: dto.gantungorderan_nobukti ?? '',
      statusformat: dto.statusformat ?? null,
      info: dto.info ?? null,
      modifiedby: dto.modifiedby ? String(dto.modifiedby).toUpperCase() : '',
      created_at: dto.created_at || this.utilsService.getTime(),
      updated_at: dto.updated_at || this.utilsService.getTime(),
    };
  }

  private parseCurrency(value: any): number {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const cleanValue = value.replace(/[^0-9.-]/g, '');
      const parsed = parseFloat(cleanValue);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  private buildDetailsData(details: any[]): any[] {
    if (!details || details.length === 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Detail kas gantung tidak boleh kosong',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return details.map((detail: any, index: number) => {
      // InputCurrency mengirim string ber-koma ribuan ('1,000,000.00'); kolom
      // nominal-nya numerik, jadi harus dibersihkan sebelum masuk query.
      const nominal = this.parseCurrency(detail.nominal);

      if (nominal <= 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: `Line ${index + 1}: Nominal harus diisi`,
            error: 'Bad Request',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      return { ...detail, nominal };
    });
  }

  private resolvePositionOrder(
    sortBy: string,
    sortDirection: string,
  ): { orderCol: string; dir: 'asc' | 'desc' } {
    const dir = sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
    switch (sortBy) {
      // Kolom relasi/bank/alatbayar tampil sebagai nama; mengurutkannya per
      // uuid tidak berarti apa-apa bagi pemakai.
      case 'relasi_id':
      case 'relasi_nama':
        return { orderCol: 'u.relasi_nama', dir };
      case 'bank_id':
      case 'bank_nama':
        return { orderCol: 'u.bank_nama', dir };
      case 'alatbayar_id':
      case 'alatbayar_nama':
        return { orderCol: 'u.alatbayar_nama', dir };
      default:
        return {
          orderCol: KasgantungheaderService.FILTERABLE_COLUMNS.has(sortBy)
            ? `u.${sortBy}`
            : 'u.nobukti',
          dir,
        };
    }
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

    const existingData = await this.baseQuery(trx)
      .select({ posval: orderCol })
      .where('u.id', id)
      .modify((qb) => this.applyFilters(qb, filters, search))
      .first();
    if (!existingData || existingData.posval === null) return 1;

    const resultposition = await this.baseQuery(trx)
      .count('* as posisi')
      .where(orderCol, dir === 'desc' ? '>=' : '<=', existingData.posval)
      .modify((qb) => this.applyFilters(qb, filters, search))
      .first();

    const posisi = Number(resultposition?.posisi ?? 0);
    return posisi > 0 ? posisi : 1;
  }

  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    if (filters?.tglDari && filters?.tglSampai) {
      qb.whereBetween('u.tglbukti', [
        formatDateToSQL(String(filters.tglDari)),
        formatDateToSQL(String(filters.tglSampai)),
      ]);
    }

    if (search) {
      const sanitized = String(search).trim();
      qb.where((query) => {
        KasgantungheaderService.SEARCHABLE_COLUMNS.forEach((field) => {
          if (this.dateFields.includes(field)) {
            query.orWhereRaw("TO_CHAR(??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
              this.columnRef(field),
              `%${sanitized}%`,
            ]);
          } else {
            query.orWhere(this.columnRef(field), 'ilike', `%${sanitized}%`);
          }
        });
      });
    }

    Object.entries(filters || {}).forEach(([key, rawValue]) => {
      if (key === 'tglDari' || key === 'tglSampai') return;
      if (!KasgantungheaderService.FILTERABLE_COLUMNS.has(key)) return;
      if (rawValue === null || rawValue === undefined || rawValue === '')
        return;

      const sanitizedValue = String(rawValue);
      if (this.dateFields.includes(key)) {
        qb.andWhereRaw("TO_CHAR(??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
          this.columnRef(key),
          `%${sanitizedValue}%`,
        ]);
      } else {
        qb.andWhere(this.columnRef(key), 'ilike', `%${sanitizedValue}%`);
      }
    });
  }

  private selectColumns(trx: any) {
    const url = 'pengeluaran';

    return [
      'u.id',
      'u.nobukti',
      trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
      'u.keterangan',
      'u.relasi_id',
      'u.bank_id',
      'u.alatbayar_id',
      'u.pengeluaran_nobukti',
      'u.coakaskeluar',
      'u.dibayarke',
      'u.nowarkat',
      trx.raw("TO_CHAR(u.tgljatuhtempo, 'DD-MM-YYYY') as tgljatuhtempo"),
      'u.gantungorderan_nobukti',
      'u.statusformat',
      'u.info',
      'u.modifiedby',
      'u.relasi_nama',
      'u.bank_nama',
      'u.alatbayar_nama',
      'u.link',
      trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
      trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
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

  async create(data: any, trx: any) {
    try {
      // 1. Ekstrak properti non-insert (pagination, search, dll) dari payload utama
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
        isreload,
        ...dto
      } = data;
      await this.setDateRangeSessionContext(trx, filters || {});
      const uuid = await uuidV7(trx);

      // 2. Validasi dan bangun data untuk Details
      const processedDetails = this.buildDetailsData(details);

      // 3. Generate Nomor Bukti Kas Gantung — formatnya menempel di bank yang
      //    dipilih, bukan di parameter global.
      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';

      const parameterCabang = await trx('parameter')
        .select(trx.raw(`JSON_VALUE(${memoExpr}, '$.CABANG_ID') AS cabang_id`))
        .where('grp', 'CABANG')
        .andWhere('subgrp', 'CABANG')
        .first();

      const formatpengeluarangantung = await trx('bank as b')
        .select('p.grp', 'p.subgrp', 'b.formatpengeluarangantung')
        .leftJoin('parameter as p', 'p.id', 'b.formatpengeluarangantung')
        .where('b.id', dto.bank_id)
        .first();

      if (!formatpengeluarangantung?.grp || !formatpengeluarangantung?.subgrp) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Format nomor kas gantung (grp/subgrp) tidak ditemukan',
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
        .where('id', formatpengeluarangantung.formatpengeluarangantung)
        .first();

      const tglBukti =
        formatDateToSQL(String(dto?.tglbukti || new Date())) ||
        String(dto?.tglbukti || new Date());

      const nomorBuktiKasGantung =
        await this.runningNumberService.generateRunningNumber(
          trx,
          formatpengeluarangantung.grp,
          formatpengeluarangantung.subgrp,
          this.tableName,
          tglBukti,
          parameterCabang?.cabang_id,
        );

      // 4. PENGELUARAN DULU: detail kas gantung menyimpan pengeluarandetail_id,
      //    jadi nomor bukti + id detail pengeluaran harus sudah terbentuk.
      const pengeluaranDetails = processedDetails.map((detail: any) => ({
        // '0' = baris baru; pengeluarandetail.create membandingkannya sebagai string.
        id: '0',
        coadebet: parameter?.coa_nama ?? null,
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
        modifiedby: dto.modifiedby ?? null,
        kasgantung_nobukti: nomorBuktiKasGantung ?? null,
      }));

      const pengeluaranResult = await this.pengeluaranheaderService.create(
        {
          tglbukti: dto.tglbukti,
          keterangan: dto.keterangan,
          relasi_id: dto.relasi_id,
          bank_id: dto.bank_id,
          alatbayar_id: dto.alatbayar_id,
          modifiedby: dto.modifiedby,
          details: pengeluaranDetails,
        },
        trx,
        // Grid yang menunggu adalah grid kas gantung; posisi baris pengeluaran
        // (dan jurnal umum di bawahnya) tidak dipakai siapa pun di sini.
        { withGridPosition: false },
      );

      const pengeluaranNoBukti = pengeluaranResult?.newItem?.nobukti;
      if (!pengeluaranNoBukti) {
        throw new HttpException(
          {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Gagal membuat pengeluaran: nobukti tidak terbentuk',
            error: 'Internal Server Error',
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      const pengeluaranDetailItems = await trx('pengeluarandetail')
        .select('id')
        .where('nobukti', pengeluaranNoBukti)
        .orderBy('id');

      if (pengeluaranDetailItems.length !== processedDetails.length) {
        throw new HttpException(
          {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Jumlah detail pengeluaran tidak sesuai dengan input',
            error: 'Internal Server Error',
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // 5. INSERT KE TABLE UTAMA (Header)
      // insertPayload sudah membawa uuid dari langkah 1; membungkusnya lagi
      // dengan withUuidV7 akan menimpanya dengan uuid baru, sehingga id yang
      // dipakai menghitung posisi grid di bawah bukan id yang benar-benar
      // tersimpan.
      const insertPayload = this.buildInsertData(uuid, {
        ...dto,
        nobukti: nomorBuktiKasGantung,
        pengeluaran_nobukti: pengeluaranNoBukti,
        statusformat: formatpengeluarangantung.formatpengeluarangantung ?? null,
      });

      const insertedItems = await trx(this.tableName)
        .insert(insertPayload)
        .returning('*');

      const newItem = insertedItems[0];

      // 6. INSERT KE TABLE DETAILS
      const detailsWithNobukti = processedDetails.map(
        (detail: any, index: number) => ({
          ...detail,
          nobukti: newItem.nobukti,
          modifiedby: detail.modifiedby ?? newItem.modifiedby,
          pengeluarandetail_id: pengeluaranDetailItems[index]?.id ?? null,
        }),
      );
      await this.kasgantungdetailService.create(
        detailsWithNobukti,
        newItem.id,
        trx,
      );

      await this.statuspendukungService.create(
        this.tableName,
        newItem.id,
        data.modifiedby,
        trx,
      );

      // 7. POSISI/PAGINATION BARIS BARU DI GRID
      const pageLimit = Number(limit) > 0 ? Number(limit) : 10;

      const totalRecords = await this.baseQuery(trx)
        .count('u.id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
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

      const paged = await this.buildPagedResult(
        trx,
        posisi,
        totalItems,
        pageLimit,
        sortBy,
        sortDirection,
        filters,
        search,
      );

      // 8. LOG TRAIL
      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD KAS GANTUNG HEADER`,
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      return {
        newItem: { ...newItem, pengeluaran_data: pengeluaranResult.newItem },
        ...paged,
        pengeluaran_nobukti: pengeluaranNoBukti,
        kasgantung_nobukti: nomorBuktiKasGantung,
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
      await this.setDateRangeSessionContext(trx, filters || {});

      let limit = pagination?.limit ?? 0;

      const sortBy = sort?.sortBy || 'nobukti';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
      const safeFilters = filters || {};

      const countResult = await this.baseQuery(trx)
        .count('u.id as total')
        .modify((qb) => this.applyFilters(qb, safeFilters, search))
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

      const query = this.baseQuery(trx).select(this.selectColumns(trx));
      query.modify((qb) => this.applyFilters(qb, safeFilters, search));

      const { orderCol } = this.resolvePositionOrder(sortBy, sortDirection);
      query.orderBy(orderCol, sortDirection);
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
      const data = await this.baseQuery(trx)
        .select(this.selectColumns(trx))
        .where('u.id', id);

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
        relasi_nama,
        bank_nama,
        alatbayar_nama,
        details,
        isreload,
        ...dto
      } = data;
      await this.setDateRangeSessionContext(trx, filters || {});

      const existingData = await trx(this.tableName).where('id', id).first();
      if (!existingData) {
        throw new NotFoundException(`Kas gantung ${id} tidak ditemukan`);
      }

      const processedDetails = this.buildDetailsData(details);

      // id sengaja dibuang dari payload update: nomor bukti & PK tidak boleh
      // ikut berubah lewat form.
      const { id: _id, ...insertData } = this.buildInsertData(undefined, {
        ...dto,
        id,
        nobukti: existingData.nobukti,
        pengeluaran_nobukti: existingData.pengeluaran_nobukti,
        created_at: existingData.created_at,
        updated_at: existingData.updated_at,
      });

      const hasChanges = this.utilsService.hasChanges(insertData, existingData);
      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(insertData);
      }

      // Pengeluaran pasangannya ikut diperbarui: detailnya dicocokkan lewat
      // pengeluarandetail_id yang disimpan di detail kas gantung.
      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';

      const formatpengeluarangantung = await trx('bank as b')
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
        .where('id', formatpengeluarangantung?.formatpengeluarangantung)
        .first();

      const pengeluaranData = await trx('pengeluaranheader')
        .where('nobukti', existingData.pengeluaran_nobukti)
        .first();

      let updatedPengeluaran: any = null;
      if (pengeluaranData) {
        const detailPengeluaran = processedDetails.map((detail: any) => {
          const { pengeluarandetail_id, ...rest } = detail;

          return {
            ...rest,
            id: pengeluarandetail_id ? String(pengeluarandetail_id) : '0',
            coadebet: parameter?.coa_nama ?? null,
            keterangan: detail.keterangan ?? null,
            nominal: detail.nominal ?? null,
            dpp: detail.dpp ?? 0,
            modifiedby: insertData.modifiedby ?? null,
            kasgantung_nobukti: existingData.nobukti ?? null,
          };
        });

        updatedPengeluaran = await this.pengeluaranheaderService.update(
          pengeluaranData.id,
          {
            tglbukti: insertData.tglbukti,
            relasi_id: insertData.relasi_id,
            keterangan: insertData.keterangan,
            bank_id: insertData.bank_id,
            alatbayar_id: insertData.alatbayar_id,
            modifiedby: insertData.modifiedby,
            details: detailPengeluaran,
          },
          trx,
          { withGridPosition: false },
        );
      }

      const detailsWithNobukti = processedDetails.map((detail: any) => ({
        ...detail,
        nobukti: existingData.nobukti,
        modifiedby: insertData.modifiedby,
      }));
      await this.kasgantungdetailService.create(detailsWithNobukti, id, trx);

      // Ambil baris yang SUDAH diperbarui (tanpa filter) supaya selalu ketemu
      // walau hasil edit tak lagi cocok dengan filter aktif.
      const updatedItem = await this.baseQuery(trx)
        .select(this.selectColumns(trx))
        .where('u.id', id)
        .first();

      const dataDetail = await this.kasgantungdetailService.findAll(
        { filters: { nobukti: existingData.nobukti } },
        trx,
      );

      // ── Posisi/pagination pasca-simpan (NON-FATAL) ───────────────────────
      // Header + detail + pengeluaran SUDAH ter-update di atas. Blok di bawah
      // hanya menghitung posisi baris di grid; kegagalannya tidak boleh
      // menggagalkan simpan yang sudah berhasil. Pemanggil internal tidak
      // mengirim sortBy/filters/limit sama sekali, jadi semua parameter grid
      // harus punya nilai default.
      const sortColumn = sortBy || 'nobukti';
      const sortDir = sortDirection || 'asc';
      const pageLimit = Number(limit) > 0 ? Number(limit) : 10;

      let paged: {
        itemIndex: number;
        pageNumber: number;
        fetchedPages: number[];
        pagedData: Record<number, any[]>;
      } = { itemIndex: 0, pageNumber: 1, fetchedPages: [1], pagedData: {} };

      try {
        const totalRecords = await this.baseQuery(trx)
          .count('u.id as total')
          .modify((qb) => this.applyFilters(qb, filters, search))
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
        console.warn(
          `Update kasgantungheader ${id} berhasil, tetapi posisi grid pasca-simpan gagal dihitung:`,
          error?.message,
        );
      }

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
          ...updatedItem,
          pengeluaran_data: updatedPengeluaran,
        },
        ...paged,
        dataDetail,
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

  async delete(id: string, trx: any, modifiedby: string) {
    try {
      // detail & statuspendukung wajib dihapus lebih dulu, header dipegang FK
      // kasgantungdetail.kasgantung_id
      const deletedDataDetail = await this.utilsService.lockAndDestroy(
        id,
        'kasgantungdetail',
        'kasgantung_id',
        trx,
      );
      await this.statuspendukungService.remove(id, modifiedby, trx);

      const deletedData = await this.utilsService.lockAndDestroy(
        id,
        this.tableName,
        'id',
        trx,
      );

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
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }

  /**
   * Daftar kas gantung yang sisanya belum nol dalam rentang tanggal — dipakai
   * lookup di layar Pengembalian Kas Gantung.
   */
  async getKasGantung(dari: any, sampai: any, trx: any) {
    try {
      const tglDariFormatted = formatDateToSQL(dari);
      const tglSampaiFormatted = formatDateToSQL(sampai);

      // Rewrite Postgres: global temp table (##temp) dan FORMAT() adalah
      // sintaks SQL Server. Agregatnya dipertahankan apa adanya, hanya
      // dipindah ke CTE.
      return await trx
        .with('kasgantung_sisa', (qb: any) => {
          qb.select(
            'kd.nobukti',
            trx.raw('CAST(kg.tglbukti AS DATE) AS tglbukti'),
            // ::numeric wajib: kolom nominal bertipe money di sebagian
            // database, dan money tidak bisa dipadukan dengan integer 0 di
            // COALESCE.
            trx.raw(`SUM(kd.nominal::numeric) - COALESCE((
                SELECT SUM(pgd.nominal::numeric)
                FROM pengembaliankasgantungdetail AS pgd
                WHERE pgd.kasgantung_nobukti = kd.nobukti
              ), 0) AS sisa`),
            trx.raw('MAX(kd.keterangan) AS keterangan'),
          )
            .from('kasgantungdetail as kd')
            .leftJoin('kasgantungheader as kg', 'kg.id', 'kd.kasgantung_id')
            .whereBetween('kg.tglbukti', [tglDariFormatted, tglSampaiFormatted])
            .groupBy('kd.nobukti', 'kg.tglbukti');
        })
        .select(
          trx.raw('ROW_NUMBER() OVER (ORDER BY nobukti) as id'),
          trx.raw("TO_CHAR(tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'nobukti',
          'sisa',
          'keterangan',
        )
        .from('kasgantung_sisa')
        .where((qb: any) => {
          qb.whereRaw('sisa <> 0').orWhereRaw('sisa IS NULL');
        })
        .orderBy('nobukti', 'asc');
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  /**
   * Baris kas gantung untuk satu pengembalian: yang SUDAH tercatat di
   * pengembalian tersebut (bayar terisi) digabung dengan yang belum pernah
   * dikembalikan sama sekali (bayar 0).
   */
  async getPengembalian(id: any, dari: any, sampai: any, trx: any) {
    try {
      const tglDariFormatted = formatDateToSQL(dari);
      const tglSampaiFormatted = formatDateToSQL(sampai);

      // ::numeric wajib: kolom nominal bertipe money di sebagian database, dan
      // money tidak bisa dipadukan dengan integer 0 di COALESCE maupun dengan
      // `0 AS bayar` di UNION.
      const sisaExpr = `SUM(kd.nominal::numeric) - COALESCE((
          SELECT SUM(pgd2.nominal::numeric)
          FROM pengembaliankasgantungdetail AS pgd2
          WHERE pgd2.kasgantung_nobukti = kd.nobukti
        ), 0)`;

      // Rewrite Postgres: dua global temp table + UNION lewat INSERT diganti
      // dua CTE. Join-nya sengaja berbeda seperti aslinya — baris "pribadi"
      // lewat kd.kasgantung_id, baris "belum dikembalikan" lewat nobukti.
      return await trx
        .with('pengembalian_pribadi', (qb: any) => {
          qb.select(
            'pgd.pengembaliankasgantung_id as pengembaliankasgantungheader_id',
            'kd.nobukti',
            trx.raw('CAST(kg.tglbukti AS DATE) AS tglbukti'),
            trx.raw('pgd.keterangan AS keterangan'),
            trx.raw('pgh.coakasmasuk AS coa'),
            trx.raw(`${sisaExpr} AS sisa`),
            trx.raw('pgd.nominal::numeric AS bayar'),
            'pgd.penerimaandetail_id',
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
            );
        })
        .with('pengembalian_baru', (qb: any) => {
          qb.select(
            trx.raw('NULL::text AS pengembaliankasgantungheader_id'),
            'kd.nobukti',
            trx.raw('CAST(kg.tglbukti AS DATE) AS tglbukti'),
            trx.raw('MAX(kd.keterangan) AS keterangan'),
            trx.raw('NULL::text AS coa'),
            trx.raw(`${sisaExpr} AS sisa`),
            trx.raw('0::numeric AS bayar'),
            trx.raw('NULL::text AS penerimaandetail_id'),
          )
            .from('kasgantungdetail as kd')
            .leftJoin('kasgantungheader as kg', 'kg.nobukti', 'kd.nobukti')
            .whereRaw(
              `kg.nobukti NOT IN (
                SELECT kasgantung_nobukti
                FROM pengembaliankasgantungdetail
                WHERE pengembaliankasgantung_id = ?
              )`,
              [id],
            )
            .whereBetween('kg.tglbukti', [tglDariFormatted, tglSampaiFormatted])
            .groupBy('kd.nobukti', 'kg.tglbukti');
        })
        .with('pengembalian_gabungan', (qb: any) => {
          qb.select('*')
            .from('pengembalian_pribadi')
            .unionAll((u: any) => {
              u.select('*')
                .from('pengembalian_baru')
                .where((w: any) => {
                  w.whereRaw('sisa <> 0').orWhereRaw('sisa IS NULL');
                });
            });
        })
        .select(
          trx.raw('ROW_NUMBER() OVER (ORDER BY nobukti) as id'),
          'pengembaliankasgantungheader_id',
          'nobukti',
          trx.raw("TO_CHAR(tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'keterangan',
          'coa as coadetail',
          'sisa',
          'bayar as nominal',
          'penerimaandetail_id',
        )
        .from('pengembalian_gabungan')
        .where((qb: any) => {
          qb.whereRaw('sisa <> 0').orWhereRaw('sisa IS NULL');
        })
        .orderBy('nobukti', 'asc');
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  /**
   * Data untuk cetak bukti kas gantung di background: satu header beserta
   * rinciannya, dipetakan ke dua datasource LaporanKasGantung.mrt — `data`
   * (header) dan `detail` (rincian nominal).
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

    const detailRes = await this.kasgantungdetailService.findAll(
      { filters: { nobukti: header.nobukti } },
      db,
    );
    const details = detailRes.data ?? [];

    // Dijumlahkan dalam satuan sen lalu dibagi 100 supaya sisa pembulatan
    // float tidak menggeser terbilang satu rupiah.
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
          judullaporan: judullaporan ?? 'Laporan Kas Gantung',
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
    const header = await this.baseQuery(db)
      .select([
        'u.nobukti',
        db.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
        'u.keterangan',
        'u.relasi_nama',
        'u.bank_nama',
        'u.alatbayar_nama',
        'u.pengeluaran_nobukti',
        'u.coakaskeluar',
        'u.dibayarke',
        'u.nowarkat',
        db.raw("TO_CHAR(u.tgljatuhtempo, 'DD-MM-YYYY') as tgljatuhtempo"),
      ])
      .where('u.id', String(id))
      .first();

    if (!header) {
      throw new NotFoundException(
        `Kas gantung dengan id ${id} tidak ditemukan`,
      );
    }

    return header;
  }

  /**
   * Rincian satu bukti, urut sesuai urutan input. Dikembalikan sebagai query
   * (bukan array) supaya ExportJobService bisa men-stream-nya lewat cursor,
   * sama seperti export daftar.
   */
  buildExportBuktiQuery(nobukti: string, db: any) {
    return db('vkasgantungdetail as d')
      .select(['d.nobukti', 'd.keterangan', 'd.nominal'])
      .where('d.nobukti', nobukti)
      .orderBy('d.id', 'asc');
  }

  /** Jumlah baris rincian — dipakai untuk progres export yang nyata. */
  async countExportBuktiRows(nobukti: string, db: any): Promise<number> {
    const result = await db('vkasgantungdetail as d')
      .count('d.id as total')
      .where('d.nobukti', nobukti)
      .first();

    return Number(result?.total ?? 0);
  }

  /** Sheet export per transaksi: blok master di atas, rincian + TOTAL di bawah. */
  buildExportBuktiSheet(header: any): ExportSheetDefinition {
    return {
      sheetName: 'Kas Gantung',
      titleLines: [
        'PT. TRANSPORINDO AGUNG SEJAHTERA',
        'LAPORAN KAS GANTUNG',
        String(header.nobukti ?? ''),
      ],
      infoLines: [
        { label: 'NO BUKTI', value: header.nobukti },
        { label: 'TGL BUKTI', value: header.tglbukti },
        { label: 'KETERANGAN', value: header.keterangan },
        { label: 'RELASI', value: header.relasi_nama },
        { label: 'BANK', value: header.bank_nama },
        { label: 'ALAT BAYAR', value: header.alatbayar_nama },
        { label: 'PENGELUARAN NO BUKTI', value: header.pengeluaran_nobukti },
        { label: 'COA KAS KELUAR', value: header.coakaskeluar },
        { label: 'DIBAYAR KE', value: header.dibayarke },
        { label: 'NO WARKAT', value: header.nowarkat },
        { label: 'TGL JATUH TEMPO', value: header.tgljatuhtempo },
      ],
      headers: ['NO.', 'NO BUKTI', 'KETERANGAN', 'NOMINAL'],
      columnFormats: [
        null,
        null,
        null,
        { numFmt: EXCEL_FORMAT.RUPIAH_DESIMAL },
      ],
      totalRow: { sumColumns: [3] },
      mapRow: (row: any, rowNumber: number) => [
        rowNumber,
        row.nobukti,
        row.keterangan,
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
}
