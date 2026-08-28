import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Workbook } from 'exceljs';
import { LocksService } from '../locks/locks.service';
import {
  formatDateToSQL,
  UtilsService,
  calculateItemIndex,
  getFetchedPages,
  uuidV7,
} from 'src/utils/utils.service';
import { GlobalService } from '../global/global.service';
import { RedisService } from 'src/common/redis/redis.service';
import {
  FindAllParams,
  WriteOptions,
} from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { JurnalumumheaderService } from '../jurnalumumheader/jurnalumumheader.service';
import { numberToTerbilang } from 'src/utils/terbilang';
import {
  EXCEL_FORMAT,
  ExportSheetDefinition,
} from 'src/common/report/export-job.service';

@Injectable()
export class PindahBukuService {
  private readonly logger = new Logger(PindahBukuService.name);

  constructor(
    // Inject wrapper RedisService (BUKAN raw 'REDIS_CLIENT'): set/get/del cache
    // jadi best-effort sehingga create/update tidak gagal 500 "Stream isn't
    // writeable" saat Redis mati. Lihat pengeluaranheader.service.ts.
    private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly jurnalUmumHeaderService: JurnalumumheaderService,
  ) {}

  private readonly tableName = 'pindahbuku';
  private readonly viewName = 'vpindahbuku';

  // vpindahbuku sudah mengembalikan tanggal sebagai teks DD-MM-YYYY, jadi
  // kolom ini di-filter sebagai teks dan diurutkan lewat TO_DATE/TO_TIMESTAMP.
  private readonly dateFields = ['tglbukti', 'tgljatuhtempo'];
  private readonly dateTimeFields = ['created_at', 'updated_at'];

  // Grid mengirim key `<x>_text`, sedangkan view menyediakannya sebagai
  // `<x>_nama`.
  private static readonly COLUMN_ALIASES: Record<string, string> = {
    bankdari_text: 'bankdari_nama',
    bankke_text: 'bankke_nama',
    coadebet_text: 'coadebet_nama',
    coakredit_text: 'coakredit_nama',
    alatbayar_text: 'alatbayar_nama',
  };

  // Kolom yang ikut disapu kotak SEARCH di grid = kolom yang tampil di grid.
  private static readonly SEARCHABLE_COLUMNS = [
    'nobukti',
    'tglbukti',
    'bankdari_nama',
    'bankke_nama',
    'coadebet_nama',
    'coakredit_nama',
    'alatbayar_nama',
    'nowarkat',
    'tgljatuhtempo',
    'keterangan',
    'nominal',
    'modifiedby',
    'created_at',
    'updated_at',
  ];

  // Key di luar daftar ini bukan kolom view dan akan membuat query gagal kalau
  // diteruskan apa adanya.
  private static readonly FILTERABLE_COLUMNS = new Set([
    ...PindahBukuService.SEARCHABLE_COLUMNS,
    'id',
    'bankdari_id',
    'bankke_id',
    'coadebet',
    'coakredit',
    'alatbayar_id',
    'statusformat',
  ]);

  private baseQuery(trx: any) {
    return trx(`${this.viewName} as u`);
  }

  private columnRef(key: string): string {
    return `u.${PindahBukuService.COLUMN_ALIASES[key] ?? key}`;
  }

  private selectColumns() {
    return [
      'u.id',
      'u.nobukti',
      'u.tglbukti',
      'u.bankdari_id',
      'u.bankke_id',
      'u.coadebet',
      'u.coakredit',
      'u.alatbayar_id',
      'u.nowarkat',
      'u.tgljatuhtempo',
      'u.keterangan',
      'u.nominal',
      'u.statusformat',
      'u.modifiedby',
      'u.created_at',
      'u.updated_at',
      'u.bankdari_nama',
      'u.bankke_nama',
      'u.coadebet_nama',
      'u.coakredit_nama',
      'u.alatbayar_nama',
    ];
  }

  // Uppercase HANYA kolom teks manusiawi. bankdari_id/bankke_id/alatbayar_id/
  // statusformat/id adalah UUID, dan coadebet/coakredit diisi dari bank.coa —
  // semuanya nilai eksak yang tak boleh diubah casing-nya. alatbayar_id
  // menunjuk alatbayar yang mayoritas id-nya kini uuid v7 HURUF KECIL: blanket
  // uppercase menulis id yang tidak ada dan (tanpa FK) diterima Postgres
  // diam-diam sehingga lookup tampil kosong — lihat pengeluaranheader.service.ts.
  private buildInsertData(
    uuid: string | undefined,
    dto: any,
  ): Record<string, any> {
    return {
      id: uuid ? uuid : dto.id ? String(dto.id) : null,
      nobukti: dto.nobukti ? String(dto.nobukti).toUpperCase() : '',
      tglbukti: dto.tglbukti ? formatDateToSQL(String(dto.tglbukti)) : null,
      bankdari_id: dto.bankdari_id ?? null,
      bankke_id: dto.bankke_id ?? null,
      coadebet: dto.coadebet ?? null,
      coakredit: dto.coakredit ?? null,
      alatbayar_id: dto.alatbayar_id ?? null,
      nowarkat: dto.nowarkat ? String(dto.nowarkat).toUpperCase() : null,
      tgljatuhtempo: dto.tgljatuhtempo
        ? formatDateToSQL(String(dto.tgljatuhtempo))
        : null,
      keterangan: dto.keterangan ? String(dto.keterangan).toUpperCase() : null,
      nominal: this.parseCurrency(dto.nominal),
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

  /** Parameter format nomor bukti + memo yang jadi `postingdari` jurnalnya. */
  private async getFormatPindahBuku(trx: any) {
    const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
    const parameter = await trx('parameter')
      .select([
        'id',
        'grp',
        'subgrp',
        trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') as memo_nama`),
      ])
      .where('grp', 'NOMOR PINDAH BUKU')
      .first();

    if (!parameter) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Parameter NOMOR PINDAH BUKU belum diatur',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return parameter;
  }

  /**
   * Coa jurnal diambil dari bank-nya, bukan dari payload: uang MASUK ke
   * bankke (debet) dan KELUAR dari bankdari (kredit).
   */
  private async resolveCoa(trx: any, bankkeId: any, bankdariId: any) {
    const [debet, kredit] = await Promise.all([
      trx('bank').select('coa').where('id', bankkeId).first(),
      trx('bank').select('coa').where('id', bankdariId).first(),
    ]);

    if (!debet?.coa || !kredit?.coa) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Bank asal / bank tujuan tidak memiliki COA',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return { coadebet: debet.coa, coakredit: kredit.coa };
  }

  /** Jurnal dua baris: debet di bank tujuan, kredit di bank asal. */
  private buildJurnalPayload(row: any, parameter: any) {
    const tglbukti = formatDateToSQL(String(row.tglbukti));

    return {
      nobukti: row.nobukti,
      tglbukti,
      postingdari: parameter.memo_nama,
      statusformat: parameter.id,
      keterangan: row.keterangan,
      created_at: this.utilsService.getTime(),
      updated_at: this.utilsService.getTime(),
      modifiedby: row.modifiedby,
      details: [
        {
          id: '0',
          coa: row.coadebet,
          nobukti: row.nobukti,
          tglbukti,
          keterangan: row.keterangan,
          nominaldebet: row.nominal,
          nominalkredit: '',
        },
        {
          id: '0',
          coa: row.coakredit,
          nobukti: row.nobukti,
          tglbukti,
          keterangan: row.keterangan,
          nominaldebet: '',
          nominalkredit: row.nominal,
        },
      ],
    };
  }

  // Rentang tanggal difilter di dalam vpindahbuku lewat current_setting, bukan
  // whereBetween: kolom tglbukti yang keluar dari view sudah berupa teks.
  private async setDateRangeSessionContext(
    trx: any,
    filters: Record<string, any>,
  ): Promise<void> {
    if (!filters?.tglDari || !filters?.tglSampai) return;

    const tglDariFormatted = formatDateToSQL(String(filters.tglDari));
    const tglSampaiFormatted = formatDateToSQL(String(filters.tglSampai));

    if (!tglDariFormatted || !tglSampaiFormatted) return;

    await trx.raw(`SELECT set_config('tas.tgldari', ?, true)`, [
      tglDariFormatted,
    ]);
    await trx.raw(`SELECT set_config('tas.tglsampai', ?, true)`, [
      tglSampaiFormatted,
    ]);
  }

  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    if (search) {
      const sanitized = String(search).trim();
      qb.where((builder: any) => {
        PindahBukuService.SEARCHABLE_COLUMNS.forEach((field) => {
          if (field === 'nominal') {
            builder.orWhereRaw('CAST(?? AS TEXT) ILIKE ?', [
              this.columnRef(field),
              `%${sanitized}%`,
            ]);
          } else {
            builder.orWhere(this.columnRef(field), 'ilike', `%${sanitized}%`);
          }
        });
      });
    }

    Object.entries(filters || {}).forEach(([key, rawValue]) => {
      if (key === 'tglDari' || key === 'tglSampai') return;

      const column = PindahBukuService.COLUMN_ALIASES[key] ?? key;
      if (!PindahBukuService.FILTERABLE_COLUMNS.has(column)) return;
      if (rawValue === null || rawValue === undefined || rawValue === '')
        return;

      const sanitizedValue = String(rawValue);
      if (column === 'nominal') {
        qb.andWhereRaw('CAST(?? AS TEXT) ILIKE ?', [
          `u.${column}`,
          `%${sanitizedValue}%`,
        ]);
      } else {
        qb.andWhere(`u.${column}`, 'ilike', `%${sanitizedValue}%`);
      }
    });
  }

  /**
   * Ekspresi ORDER BY, bukan sekadar nama kolom: tanggal keluar dari view
   * sebagai teks DD-MM-YYYY, jadi mengurutkannya apa adanya menaruh 12-01-2026
   * sebelum 05-02-2025. Ekspresi yang sama dipakai resolvePosition supaya
   * posisi baris pasca-simpan sejalan dengan urutan yang tampil di grid.
   */
  private resolveOrderExpr(
    sortBy: string,
    sortDirection: string,
  ): { expr: string; dir: 'asc' | 'desc' } {
    const dir = sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
    const aliased = PindahBukuService.COLUMN_ALIASES[sortBy] ?? sortBy;
    // Tanpa fallback, create/update yang dipanggil bersarang (payloadnya tidak
    // membawa sortBy) menghasilkan kolom 'u.undefined'.
    const column = PindahBukuService.FILTERABLE_COLUMNS.has(aliased)
      ? aliased
      : 'nobukti';

    if (this.dateFields.includes(column)) {
      return { expr: `TO_DATE(u.${column}, 'DD-MM-YYYY')`, dir };
    }
    if (this.dateTimeFields.includes(column)) {
      return {
        expr: `TO_TIMESTAMP(u.${column}, 'DD-MM-YYYY HH24:MI:SS')`,
        dir,
      };
    }
    return { expr: `u.${column}`, dir };
  }

  private async resolvePosition(
    trx: any,
    id: string,
    filters: Record<string, any>,
    search: string | undefined,
    sortBy: string,
    sortDirection: string,
  ): Promise<number> {
    const { expr, dir } = this.resolveOrderExpr(sortBy, sortDirection);

    const existingData = await this.baseQuery(trx)
      .select(trx.raw(`${expr} as posval`))
      .where('u.id', String(id))
      .modify((qb: any) => this.applyFilters(qb, filters, search))
      .first();
    if (!existingData || existingData.posval === null) return 1;

    const resultposition = await this.baseQuery(trx)
      .count('* as posisi')
      .whereRaw(`${expr} ${dir === 'desc' ? '>=' : '<='} ?`, [
        existingData.posval,
      ])
      .modify((qb: any) => this.applyFilters(qb, filters, search))
      .first();

    const posisi = Number(resultposition?.posisi ?? 0);
    return posisi > 0 ? posisi : 1;
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

  async create(data: any, trx: any, options: WriteOptions = {}) {
    const { withGridPosition = true } = options;
    try {
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        method,
        isreload,
        bankdari_nama,
        bankke_nama,
        alatbayar_nama,
        ...dto
      } = data;

      await this.setDateRangeSessionContext(trx, filters || {});

      const uuid = await uuidV7(trx);
      const parameter = await this.getFormatPindahBuku(trx);

      const tglBukti =
        formatDateToSQL(String(dto?.tglbukti || new Date())) ||
        String(dto?.tglbukti || new Date());

      dto.nobukti = await this.runningNumberService.generateRunningNumber(
        trx,
        parameter.grp,
        parameter.subgrp,
        this.tableName,
        tglBukti,
      );
      dto.statusformat = parameter.id;

      const { coadebet, coakredit } = await this.resolveCoa(
        trx,
        dto.bankke_id,
        dto.bankdari_id,
      );
      dto.coadebet = coadebet;
      dto.coakredit = coakredit;

      // insertPayload sudah membawa uuid, jadi jangan dibungkus withUuidV7 lagi
      // — id yang dipakai menghitung posisi grid harus id yang tersimpan.
      const insertedItems = await trx(this.tableName)
        .insert(this.buildInsertData(uuid, dto))
        .returning('*');
      const newItem = insertedItems[0];

      // withGridPosition false: jurnal umum dipanggil bersarang di sini, dan
      // payloadnya tidak membawa sortBy/limit milik grid jurnal.
      await this.jurnalUmumHeaderService.create(
        this.buildJurnalPayload(newItem, parameter),
        trx,
        { withGridPosition: false },
      );

      // Posisi/pagination hanya dipakai grid pindah buku untuk memfokuskan
      // baris baru. Tetap dibungkus try/catch: header sudah tersimpan, jadi
      // gagal menghitung posisi tidak boleh me-rollback simpan yang berhasil.
      let paged: Awaited<ReturnType<typeof this.buildPagedResult>> = {
        itemIndex: 0,
        pageNumber: 1,
        fetchedPages: [1],
        pagedData: {},
      };
      if (withGridPosition) {
        try {
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
            `Gagal menghitung posisi grid pindah buku: ${error?.message}`,
          );
        }
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD PINDAH BUKU',
          idtrans: newItem.id,
          nobuktitrans: newItem.nobukti,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      return { newItem, ...paged };
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
      const safeFilters = filters || {};

      const sortBy = sort?.sortBy || 'nobukti';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';

      await this.setDateRangeSessionContext(trx, safeFilters);

      const countResult = await this.baseQuery(trx)
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

      const query = this.baseQuery(trx)
        .select(this.selectColumns())
        .modify((qb: any) => this.applyFilters(qb, safeFilters, search));

      const { expr, dir } = this.resolveOrderExpr(sortBy, sortDirection);
      query.orderByRaw(`${expr} ${dir === 'desc' ? 'DESC' : 'ASC'}`);

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
      console.error('Error to findAll Pindah Buku', error);
      throw new InternalServerErrorException('Failed to fetch pindah buku');
    }
  }

  async findOne(id: string, trx: any) {
    try {
      const data = await this.baseQuery(trx)
        .select(this.selectColumns())
        .where('u.id', id);

      return {
        data: data,
      };
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async update(id: string, data: any, trx: any, options: WriteOptions = {}) {
    const { withGridPosition = true } = options;
    try {
      const existingData = await trx(this.tableName).where('id', id).first();

      if (!existingData) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Data Not Found!',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        method,
        isreload,
        bankdari_nama,
        bankke_nama,
        alatbayar_nama,
        ...dto
      } = data;

      await this.setDateRangeSessionContext(trx, filters || {});

      const parameter = await this.getFormatPindahBuku(trx);
      const { coadebet, coakredit } = await this.resolveCoa(
        trx,
        dto.bankke_id,
        dto.bankdari_id,
      );

      dto.coadebet = coadebet;
      dto.coakredit = coakredit;
      // nobukti tidak boleh ikut berubah saat edit: ia kunci jurnal umumnya.
      dto.nobukti = existingData.nobukti;
      dto.statusformat = existingData.statusformat ?? parameter.id;

      // id/created_at/updated_at dibuang dari payload: id tidak boleh berubah,
      // created_at milik baris lama, dan updated_at yang selalu "sekarang"
      // membuat hasChanges tidak pernah false.
      const {
        id: _id,
        created_at,
        updated_at,
        ...updatePayload
      } = this.buildInsertData(undefined, dto);

      const hasChanges = this.utilsService.hasChanges(
        updatePayload,
        existingData,
      );
      if (hasChanges) {
        updatePayload.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(updatePayload);
      }

      const jurnalPayload = this.buildJurnalPayload(
        { ...updatePayload, nobukti: existingData.nobukti },
        parameter,
      );
      const getJurnal = await trx('jurnalumumheader')
        .where('nobukti', existingData.nobukti)
        .first();

      if (getJurnal) {
        await this.jurnalUmumHeaderService.update(
          getJurnal.id,
          jurnalPayload,
          trx,
          { withGridPosition: false },
        );
      } else {
        await this.jurnalUmumHeaderService.create(jurnalPayload, trx, {
          withGridPosition: false,
        });
      }

      // Ambil baris yang SUDAH diperbarui (tanpa filter) supaya selalu ketemu
      // walau hasil edit tak lagi cocok dengan filter aktif.
      const updatedItem = await this.baseQuery(trx)
        .select(this.selectColumns())
        .where('u.id', id)
        .first();

      let paged: Awaited<ReturnType<typeof this.buildPagedResult>> = {
        itemIndex: 0,
        pageNumber: 1,
        fetchedPages: [1],
        pagedData: {},
      };
      if (withGridPosition) {
        try {
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
            `Update pindah buku ${id} berhasil, tetapi posisi grid pasca-simpan gagal dihitung: ${error?.message}`,
          );
        }
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT PINDAH BUKU',
          idtrans: id,
          nobuktitrans: existingData.nobukti,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      return { updatedItem, ...paged };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      console.error('Error updating pindah buku:', error);
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
      const deletedData = await this.utilsService.lockAndDestroy(
        id,
        this.tableName,
        'id',
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE PINDAH BUKU',
          idtrans: id,
          nobuktitrans: deletedData.nobukti,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby,
        },
        trx,
      );

      const getJurnal = await trx('jurnalumumheader')
        .where('nobukti', deletedData.nobukti)
        .first();

      if (getJurnal) {
        await this.jurnalUmumHeaderService.delete(
          getJurnal.id,
          trx,
          modifiedby,
        );
      }

      return {
        status: 200,
        message: 'Data deleted successfully',
        deletedData,
      };
    } catch (error) {
      console.error('Error deleting data: ', error);
      if (error instanceof HttpException) {
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

  /**
   * Pindah buku tidak punya tabel rincian: satu bukti = satu baris. Baris
   * "rincian" yang dicetak/diekspor dirakit dari kolom pembayaran di header
   * (alat bayar, warkat, jatuh tempo, nominal) — bentuk yang sama dengan
   * tabel rincian modul header/detail lain.
   */
  private buildBuktiDetails(header: any) {
    return [
      {
        nobukti: header.nobukti,
        alatbayar_nama: header.alatbayar_nama,
        tgljatuhtempo: header.tgljatuhtempo,
        nowarkat: header.nowarkat,
        keterangan: header.keterangan,
        nominal: header.nominal,
      },
    ];
  }

  /**
   * Data untuk cetak bukti pindah buku di background. LaporanPindahBuku.mrt
   * mencetak SELURUH isinya dari datasource `data`: satu bukti = satu baris,
   * jadi alat bayar/warkat/nominal ikut di header. `detail` tetap dikirim
   * karena template mendeklarasikannya (sekarang tanpa kolom, tanpa band) —
   * begitu rincian ditambahkan di designer, datanya sudah tersedia.
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
    const details = this.buildBuktiDetails(header);

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
          judullaporan: judullaporan ?? 'Laporan Pindah Buku',
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
        'u.tglbukti',
        'u.keterangan',
        'u.bankdari_nama',
        'u.bankke_nama',
        'u.coadebet',
        'u.coadebet_nama',
        'u.coakredit',
        'u.coakredit_nama',
      ])
      .where('u.id', String(id))
      .first();

    if (!header) {
      throw new NotFoundException(
        `Pindah buku dengan id ${id} tidak ditemukan`,
      );
    }

    return header;
  }

  /**
   * Rincian satu bukti. Dikembalikan sebagai query (bukan array) supaya
   * ExportJobService bisa men-stream-nya lewat cursor, sama seperti modul
   * header/detail lain — di sini isinya selalu satu baris.
   */
  buildExportBuktiQuery(nobukti: string, db: any) {
    return db(`${this.viewName} as u`)
      .select([
        'u.nobukti',
        'u.alatbayar_nama',
        'u.tgljatuhtempo',
        'u.nowarkat',
        'u.keterangan',
        'u.nominal',
      ])
      .where('u.nobukti', nobukti)
      .orderBy('u.id', 'asc');
  }

  /** Jumlah baris rincian — dipakai untuk progres export yang nyata. */
  async countExportBuktiRows(nobukti: string, db: any): Promise<number> {
    const result = await db(`${this.viewName} as u`)
      .count('u.id as total')
      .where('u.nobukti', nobukti)
      .first();

    return Number(result?.total ?? 0);
  }

  /** Sheet export per transaksi: blok master di atas, rincian + TOTAL di bawah. */
  buildExportBuktiSheet(header: any): ExportSheetDefinition {
    return {
      sheetName: 'Pindah Buku',
      titleLines: [
        'PT. TRANSPORINDO AGUNG SEJAHTERA',
        'LAPORAN PINDAH BUKU',
        String(header.nobukti ?? ''),
      ],
      infoLines: [
        { label: 'NO BUKTI', value: header.nobukti },
        { label: 'TGL BUKTI', value: header.tglbukti },
        { label: 'MUTASI DARI', value: header.bankdari_nama },
        { label: 'MUTASI KE', value: header.bankke_nama },
        { label: 'COA DEBET', value: header.coadebet_nama },
        { label: 'COA KREDIT', value: header.coakredit_nama },
        { label: 'KETERANGAN', value: header.keterangan },
      ],
      headers: [
        'NO.',
        'ALAT BAYAR',
        'TGL JATUH TEMPO',
        'NO WARKAT',
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
        row.alatbayar_nama,
        row.tgljatuhtempo,
        row.nowarkat,
        row.keterangan,
        row.nominal,
      ],
    };
  }

  async exportToExcel(data: any[], trx: any) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    // Header laporan
    worksheet.mergeCells('A1:F1');
    worksheet.mergeCells('A2:F2');
    worksheet.mergeCells('A3:F3');

    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN PINDAH BUKU';
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
      const headerInfo = [
        ['No Bukti', h.nobukti ?? ''],
        ['Tanggal', h.tglbukti ?? ''],
        ['Mutasi Dari', h.bankdari_nama ?? ''],
        ['Mutasi Ke', h.bankke_nama ?? ''],
        ['Keterangan', h.keterangan ?? ''],
      ];

      const details = this.buildBuktiDetails(h);

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
        const tableHeaders = [
          'NO.',
          'ALAT BAYAR',
          'TGL JATUH TEMPO',
          'NO WARKAT',
          'KETERANGAN',
          'NOMINAL',
        ];

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
            d.alatbayar_nama ?? '',
            d.tgljatuhtempo ?? '',
            d.nowarkat ?? '',
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

            if (colIndex === 5) {
              cell.value = Number(value);
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
          currentRow++;
        });

        const totalNominal = details.reduce(
          (sum: number, d: any) => sum + (Number(d.nominal) || 0),
          0,
        );

        worksheet.mergeCells(`A${currentRow}:E${currentRow}`);
        const totalLabelCell = worksheet.getCell(currentRow, 1);

        totalLabelCell.value = 'TOTAL';
        totalLabelCell.font = { bold: true, name: 'Tahoma', size: 10 };
        totalLabelCell.alignment = { horizontal: 'left', vertical: 'middle' };
        totalLabelCell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };

        const totalValueCell = worksheet.getCell(currentRow, 6);
        totalValueCell.value = totalNominal;
        totalValueCell.font = { bold: true, name: 'Tahoma', size: 10 };
        totalValueCell.alignment = { horizontal: 'right', vertical: 'middle' };
        totalValueCell.numFmt = '#,##0.00'; // format angka dengan ribuan
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
    worksheet.getColumn(4).width = 30;
    worksheet.getColumn(5).width = 40;
    worksheet.getColumn(6).width = 30;

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_pindahbuku${Date.now()}.xlsx`,
    );

    await workbook.xlsx.writeFile(tempFilePath);
    return tempFilePath;
  }
}
