import * as fs from 'fs';
import * as path from 'path';
import { Column, Workbook } from 'exceljs';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LocksService } from '../locks/locks.service';
import { GlobalService } from '../global/global.service';
import { RedisService } from 'src/common/redis/redis.service';
import {
  FindAllParams,
  WriteOptions,
} from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import {
  formatDateToSQL,
  UtilsService,
  calculateItemIndex,
  getFetchedPages,
  uuidV7,
} from 'src/utils/utils.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { BiayaExtraMuatanDetailService } from '../biaya-extra-muatan-detail/biaya-extra-muatan-detail.service';

@Injectable()
export class BiayaExtraHeaderService {
  private readonly logger = new Logger(BiayaExtraHeaderService.name);

  constructor(
    // Wrapper RedisService (BUKAN raw 'REDIS_CLIENT'): set/get/del jadi
    // best-effort sehingga create/update tidak gagal 500 "Stream isn't
    // writeable" saat Redis mati.
    private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly biayaExtraMuatanDetailService: BiayaExtraMuatanDetailService,
  ) {}

  private readonly tableName = 'biayaextraheader';
  private readonly viewName = 'vbiayaextraheader';
  private readonly detailTableName = 'biayaextramuatandetail';

  private readonly dateFields = ['tglbukti', 'created_at', 'updated_at'];

  /**
   * Detail biaya extra dipecah per jenis order, tapi baru MUATAN yang punya
   * tabel + service-nya (bongkaran/import/export belum ada). Dijadikan satu
   * titik supaya penambahan jenis berikutnya tidak perlu menyentuh
   * create/update/findOne/delete satu per satu — sebelumnya tiap method
   * menembak empat query `jenisorder` yang tiga di antaranya tidak dipakai.
   */
  private resolveDetailService(_jenisorderId?: string) {
    return this.biayaExtraMuatanDetailService;
  }

  private resolveDetailTable(_jenisorderId?: string) {
    return this.detailTableName;
  }

  async resolveJenisOrderId(filters: any, trx: any): Promise<string> {
    if (
      filters?.jenisOrderan &&
      filters?.jenisOrderan !== null &&
      filters?.jenisOrderan !== 'null'
    ) {
      return filters.jenisOrderan;
    }

    const orderanMuatan = await trx('jenisorder')
      .select('id')
      .where('nama', 'MUATAN')
      .first();

    return orderanMuatan?.id;
  }

  private buildInsertData(
    uuid: string | undefined,
    dto: any,
  ): Record<string, any> {
    // Uppercase HANYA kolom teks manusiawi: id/jenisorder_id/biayaemkl_id/
    // statusformat adalah UUID bertipe text (case-sensitive) yang rusak bila
    // ikut di-uppercase.
    return {
      id: uuid ? uuid : (dto.id ?? null),
      nobukti: dto.nobukti ? String(dto.nobukti).toUpperCase() : null,
      tglbukti: dto.tglbukti ? formatDateToSQL(String(dto.tglbukti)) : null,
      jenisorder_id: dto.jenisorder_id ?? null,
      biayaemkl_id: dto.biayaemkl_id ?? null,
      keterangan: dto.keterangan ? String(dto.keterangan).toUpperCase() : null,
      statusformat: dto.statusformat ?? null,
      info: dto.info ?? null,
      modifiedby: dto.modifiedby ? String(dto.modifiedby).toUpperCase() : null,
      created_at: dto.created_at || this.utilsService.getTime(),
      updated_at: dto.updated_at || this.utilsService.getTime(),
    };
  }

  /**
   * Baris detail yang dikirim ke BiayaExtraMuatanDetailService.create.
   * Kolomnya dipetakan eksplisit (bukan spread payload form) supaya field
   * tampilan seperti statustagih_nama/groupbiayaextra_nama/isNew tidak ikut
   * masuk ke perbandingan hasChanges di service detail.
   */
  private buildDetailsData(details: any[], header: any): any[] {
    return details.map((detail: any) => ({
      id: detail.id || 0,
      nobukti: header.nobukti,
      biayaextra_id: header.id,
      orderanmuatan_nobukti: detail.orderanmuatan_nobukti,
      estimasi: detail.estimasi,
      statustagih: detail.statustagih,
      nominaltagih: detail.nominaltagih,
      keterangan: detail.keterangan || '',
      groupbiayaextra_id: detail.groupbiayaextra_id,
      modifiedby: header.modifiedby,
    }));
  }

  private dateFormat(key: string): string {
    return key === 'tglbukti' ? 'DD-MM-YYYY' : 'DD-MM-YYYY HH24:MI:SS';
  }

  private periodBounds(filters: Record<string, any>) {
    return {
      tglDari: filters?.tglDari
        ? formatDateToSQL(String(filters.tglDari))
        : null,
      tglSampai: filters?.tglSampai
        ? formatDateToSQL(String(filters.tglSampai))
        : null,
    };
  }

  /**
   * Periode dan jenis order diturunkan ke vbiayaextraheader lewat GUC
   * (`tas.tgldari`, `tas.tglsampai`, `tas.jenisorder_id`), bukan sebagai
   * predikat di query luar: view menyaring biayaextraheader SEBELUM LEFT JOIN
   * jenisorder/biayaemkl, jadi kedua join hanya kena baris satu periode.
   *
   * `set_config(..., true)` hanya hidup selama transaksi — jalur tanpa trx
   * (export background) wajib memakai applyPeriodFilters.
   */
  private async setGridSessionContext(
    trx: any,
    filters: Record<string, any>,
    jenisorderId?: string,
  ): Promise<void> {
    const { tglDari, tglSampai } = this.periodBounds(filters);

    await trx.raw(
      `SELECT set_config('tas.jenisorder_id', ?, true),
              set_config('tas.tgldari', ?, true),
              set_config('tas.tglsampai', ?, true)`,
      [jenisorderId ?? '', tglDari ?? '', tglSampai ?? ''],
    );
  }

  /** Padanan setGridSessionContext untuk jalur tanpa transaksi. */
  private applyPeriodFilters(
    qb: any,
    filters: Record<string, any>,
    jenisorderId?: string,
  ): void {
    if (jenisorderId) {
      qb.where('u.jenisorder_id', jenisorderId);
    }

    // Tiap batas berdiri sendiri, sama seperti view — bukan "kalau dua-duanya
    // ada" — supaya export dan grid menyaring identik.
    const { tglDari, tglSampai } = this.periodBounds(filters);
    if (tglDari) {
      qb.where('u.tglbukti', '>=', tglDari);
    }
    if (tglSampai) {
      // tglbukti bertipe datetime: `<= tglsampai` membuang baris hari terakhir
      // yang jamnya bukan 00:00.
      qb.whereRaw("u.tglbukti < ?::date + INTERVAL '1 day'", [tglSampai]);
    }
  }

  /**
   * Search global + filter per kolom. Periode/jenis order TIDAK di sini —
   * keduanya urusan setGridSessionContext (jalur transaksi) atau
   * applyPeriodFilters (export).
   */
  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    const excludeSearchKeys = ['tglDari', 'tglSampai', 'jenisOrderan'];

    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );

    if (search && searchFields.length > 0) {
      const sanitized = String(search).trim();
      qb.where((query) => {
        searchFields.forEach((field) => {
          if (this.dateFields.includes(field)) {
            query.orWhereRaw(
              `TO_CHAR(u.??, '${this.dateFormat(field)}') ILIKE ?`,
              [field, `%${sanitized}%`],
            );
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
        qb.andWhereRaw(`TO_CHAR(u.??, '${this.dateFormat(key)}') ILIKE ?`, [
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
    switch (sortBy) {
      case 'jenisorder_nama':
        return { orderCol: 'u.jenisorder_text', dir };
      case 'biayaemkl_nama':
        return { orderCol: 'u.biayaemkl_text', dir };
      default:
        // Tanpa fallback, create/update yang dipanggil bersarang (payloadnya
        // tidak membawa sortBy) menghasilkan kolom 'u.undefined'.
        return { orderCol: `u.${sortBy || 'nobukti'}`, dir };
    }
  }

  /**
   * Posisi 1-based baris `id` pada urutan grid — dihitung lewat COUNT, bukan
   * dengan menarik seluruh baris hasil filter ke memori lalu findIndex.
   */
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
      .modify((qb) => this.applyFilters(qb, filters, search))
      .first();
    if (!existingData || existingData.posval === null) return 1;

    const resultposition = await trx(`${this.viewName} as u`)
      .count('* as posisi')
      .where(orderCol, dir === 'desc' ? '>=' : '<=', existingData.posval)
      .modify((qb) => this.applyFilters(qb, filters, search))
      .first();

    const posisi = Number(resultposition?.posisi ?? 0);
    return posisi > 0 ? posisi : 1;
  }

  private viewColumns(trx: any) {
    return [
      'u.id',
      'u.nobukti',
      trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
      'u.jenisorder_id',
      'u.biayaemkl_id',
      'u.keterangan',
      'u.statusformat',
      'u.info',
      'u.modifiedby',
      trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
      trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
      'u.jenisorder_text as jenisorder_nama',
      'u.biayaemkl_text as biayaemkl_nama',
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
    jenisorderId: string,
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
        filters: { ...(filters || {}), jenisOrderan: jenisorderId },
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
      // 1. Pisahkan properti non-insert (pagination, search, dll) dari payload
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        details,
        isreload,
        method,
        ...dto
      } = data;
      const uuid = await uuidV7(trx);

      // 2. Nomor bukti otomatis + statusformat dari parameter
      const parameter = await trx('parameter')
        .select('id', 'grp', 'subgrp')
        .where('grp', 'NOMOR EXTRA BIAYA')
        .andWhere('kelompok', 'EXTRA BIAYA')
        .first();

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

      // 3. INSERT HEADER. insertPayload sudah membawa uuid; membungkusnya lagi
      // dengan withUuidV7 akan menimpanya dengan uuid baru sehingga id yang
      // dipakai menghitung posisi grid bukan id yang benar-benar tersimpan.
      const insertPayload = this.buildInsertData(uuid, dto);
      const insertedItems = await trx(this.tableName)
        .insert(insertPayload)
        .returning('*');
      const newItem = insertedItems[0];

      // 4. INSERT DETAIL
      if (details && details.length > 0) {
        const detailService = this.resolveDetailService(newItem.jenisorder_id);
        await detailService.create(
          this.buildDetailsData(details, newItem),
          newItem.id,
          trx,
        );
      }

      // 5. Posisi/pagination pasca-simpan (NON-FATAL). Header + detail sudah
      // tersimpan, jadi gagal menghitung posisi tidak boleh me-rollback simpan
      // yang berhasil. Pemanggil bersarang mematikannya lewat withGridPosition.
      let paged: Awaited<ReturnType<typeof this.buildPagedResult>> = {
        itemIndex: 0,
        pageNumber: 1,
        fetchedPages: [1],
        pagedData: {},
      };
      if (withGridPosition) {
        try {
          const jenisorderId = newItem.jenisorder_id;
          await this.setGridSessionContext(trx, filters || {}, jenisorderId);
          const totalRecords = await trx(`${this.viewName} as u`)
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

          paged = await this.buildPagedResult(
            trx,
            posisi,
            totalItems,
            Number(limit) > 0 ? Number(limit) : 10,
            sortBy,
            sortDirection,
            filters,
            search,
            jenisorderId,
          );
        } catch (error) {
          this.logger.warn(
            `Gagal menghitung posisi grid biaya extra: ${error?.message}`,
          );
        }
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD BIAYA EXTRA HEADER',
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      return { newItem, ...paged };
    } catch (error) {
      console.error('Error creating biaya extra header:', error.message);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process creating biaya extra header in service',
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
      const jenisorderId = await this.resolveJenisOrderId(safeFilters, trx);
      await this.setGridSessionContext(trx, safeFilters, jenisorderId);

      // Total dihitung DENGAN filter yang sama seperti datanya; sebelumnya
      // COUNT jalan tanpa filter sehingga totalPages grid selalu memakai jumlah
      // seluruh tabel.
      const countResult = await trx(`${this.viewName} as u`)
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

      const query = trx(`${this.viewName} as u`).select(this.viewColumns(trx));
      query.modify((qb) => this.applyFilters(qb, safeFilters, search));
      const { orderCol } = this.resolvePositionOrder(sortBy, sortDirection);
      query.orderBy(orderCol, sortDirection);

      // buildPagedResult mengambil BEBERAPA halaman sekaligus (limit =
      // totalDataNeeded) tapi offsetnya harus tetap dihitung per ukuran halaman.
      // Tanpa cabang customOffset, offset jadi (startPage-1)*totalDataNeeded —
      // melewati akhir data begitu startPage > 1.
      const offset =
        useCustomOffset === true && customOffset !== undefined
          ? customOffset
          : (page - 1) * limit;

      if (limit > 0) {
        query.offset(offset).limit(limit);
      }
      console.log(query.toQuery());
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
      console.error('Error to findAll Biaya Extra Header', error);
      throw new Error('Failed to fetch data');
    }
  }

  /**
   * Satu bukti + rinciannya, dipipihkan jadi satu baris per detail — bentuk itu
   * yang dibaca exportToExcel dan datasource LaporanBiayaExtra.mrt.
   */
  async findOne(id: string, trx: any) {
    try {
      const header = await trx(`${this.viewName} as u`)
        .select(this.viewColumns(trx))
        .where('u.id', id)
        .first();

      if (!header) {
        return { data: [] };
      }

      const detailService = this.resolveDetailService(header.jenisorder_id);
      const { data: details } = await detailService.findAll(
        { filters: { biayaextra_id: id } },
        trx,
      );

      // jenisorderan_nama (bukan jenisorder_nama) dipertahankan karena dipakai
      // template Excel & .mrt yang sudah ada.
      const headerRow = {
        ...header,
        jenisorderan_nama: header.jenisorder_nama,
      };

      if (!details?.length) {
        return { data: [headerRow] };
      }

      return {
        data: details.map((detail: any) => ({
          ...headerRow,
          orderanmuatan_nobukti: detail.orderanmuatan_nobukti,
          estimasi: detail.estimasi,
          nominal: detail.nominal,
          statustagih: detail.statustagih,
          statustagih_nama: detail.statustagih_nama,
          nominaltagih: detail.nominaltagih,
          keterangan_detail: detail.keterangan,
          groupbiayaextra_id: detail.groupbiayaextra_id,
          groupbiayaextra_nama: detail.groupbiayaextra_nama,
        })),
      };
    } catch (error) {
      console.error('Error fetching biaya extra header by id:', error);
      throw new Error('Failed to fetch data findone biaya extra header by id');
    }
  }

  async findOneDetail(id: string, jenisOrderan: any, trx: any) {
    try {
      const detailService = this.resolveDetailService(String(jenisOrderan));
      const result = await detailService.findOne(id, trx);
      return { data: result };
    } catch (error) {
      console.error('Error fetching detail biaya extra by id:', error);
      throw new Error('Failed to fetch data find one detail biaya extra by id');
    }
  }

  async getDetailByJob(filters: any, trx: any) {
    try {
      const detailService = this.resolveDetailService(filters?.jenisOrderan);
      const result = await detailService.biayaExraByJob(filters, trx);
      return { data: result };
    } catch (error) {
      console.error('Error fetching data find one detail by job:', error);
      throw new Error('Failed to fetch data find one detail by job');
    }
  }

  async update(id: string, data: any, trx: any, options: WriteOptions = {}) {
    const { withGridPosition = true } = options;
    try {
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        details,
        isreload,
        method,
        ...dto
      } = data;

      const existingData = await trx(this.tableName).where('id', id).first();
      if (!existingData) {
        throw new NotFoundException(`Biaya extra header ${id} tidak ditemukan`);
      }

      const updatePayload = {
        nobukti: String(dto.nobukti ?? existingData.nobukti).toUpperCase(),
        tglbukti: dto.tglbukti
          ? formatDateToSQL(String(dto.tglbukti))
          : existingData.tglbukti,
        jenisorder_id: dto.jenisorder_id ?? existingData.jenisorder_id,
        biayaemkl_id: dto.biayaemkl_id ?? existingData.biayaemkl_id,
        keterangan: dto.keterangan
          ? String(dto.keterangan).toUpperCase()
          : null,
        modifiedby: dto.modifiedby
          ? String(dto.modifiedby).toUpperCase()
          : existingData.modifiedby,
      };

      const hasChanges = this.utilsService.hasChanges(
        updatePayload,
        existingData,
      );
      if (hasChanges) {
        await trx(this.tableName)
          .where('id', id)
          .update({
            ...updatePayload,
            updated_at: this.utilsService.getTime(),
          });
      }

      // Detail selalu di-upsert walau header tidak berubah: user boleh mengedit
      // hanya baris detail, dan create() detail sudah menangani update/hapus/
      // insert sekaligus.
      if (details && details.length > 0) {
        const detailService = this.resolveDetailService(
          updatePayload.jenisorder_id,
        );
        await detailService.create(
          this.buildDetailsData(details, { id, ...updatePayload }),
          id,
          trx,
        );
      }

      // Ambil baris yang SUDAH diperbarui (tanpa filter) supaya selalu ketemu
      // walau hasil edit tak lagi cocok dengan filter aktif. HARUS sebelum
      // setGridSessionContext: begitu GUC periode terpasang, view sendiri yang
      // menyaring dan baris di luar periode balik null.
      const updatedData = await trx(`${this.viewName} as u`)
        .select(this.viewColumns(trx))
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
          const jenisorderId = updatePayload.jenisorder_id;
          await this.setGridSessionContext(trx, filters || {}, jenisorderId);
          const totalRecords = await trx(`${this.viewName} as u`)
            .count('u.id as total')
            .modify((qb) => this.applyFilters(qb, filters, search))
            .first();
          const totalItems = Number(totalRecords?.total ?? 0);

          const posisi = await this.resolvePosition(
            trx,
            id,
            filters,
            search,
            sortBy || 'nobukti',
            sortDirection || 'asc',
          );

          paged = await this.buildPagedResult(
            trx,
            posisi,
            totalItems,
            Number(limit) > 0 ? Number(limit) : 10,
            sortBy || 'nobukti',
            sortDirection || 'asc',
            filters,
            search,
            jenisorderId,
          );
        } catch (error) {
          this.logger.warn(
            `Update biayaextraheader ${id} berhasil, tetapi posisi grid pasca-simpan gagal dihitung: ${error?.message}`,
          );
        }
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT BIAYA EXTRA HEADER',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(updatedData),
          modifiedby: updatePayload.modifiedby,
        },
        trx,
      );

      // Kunci `updatedData` (bukan updatedItem seperti jurnal umum) karena grid
      // biaya extra memfokuskan ulang baris lewat data.updatedData?.id.
      return { updatedData, ...paged };
    } catch (error) {
      console.error('Error update biaya extra header:', error.message);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process update biaya extra header in service',
      );
    }
  }

  async delete(id: string, trx: any, modifiedby: any) {
    try {
      const header = await trx(this.tableName)
        .select('jenisorder_id')
        .where('id', id)
        .first();

      // Detail dihapus lebih dulu (header dipegang biayaextra_id) — satu DELETE
      // untuk seluruh rincian, bukan lockAndDestroy per baris.
      const deletedDataDetail = await this.utilsService.lockAndDestroy(
        id,
        this.resolveDetailTable(header?.jenisorder_id),
        'biayaextra_id',
        trx,
      );

      const deletedData = await this.utilsService.lockAndDestroy(
        id,
        this.tableName,
        'id',
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE BIAYA EXTRA HEADER',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'DELETE',
          datajson: JSON.stringify({ deletedData, deletedDataDetail }),
          modifiedby: String(modifiedby ?? 'unknown').toUpperCase(),
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

  async loadReportData(
    id: string,
    { username, judullaporan }: { username: string; judullaporan?: string },
    db: any,
  ): Promise<Record<string, any[]>> {
    const { data: rows } = await this.findOne(id, db);

    if (!rows?.length) {
      return { data: [], detail: [], detail_rincian: [] };
    }

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const tglcetak =
      `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ` +
      `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    return {
      data: rows.map((row: any) => ({
        ...row,
        judullaporan: judullaporan ?? 'Laporan Biaya Extra',
        usercetak: username,
        tglcetak,
        judul: 'Bukti Biaya Extra EMKL',
      })),
      detail: [],
      detail_rincian: [],
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
   * Query dasar export daftar Biaya Extra: filter, jenis order, dan sort yang
   * sama dengan findAll, TANPA paging dan hanya kolom yang dipakai file Excel.
   *
   * `jenisorderId` sudah diresolusi di controller (lewat resolveJenisOrderId)
   * karena ExportJobService meminta stream secara sinkron.
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
      jenisorderId,
    }: Pick<FindAllParams, 'search' | 'filters' | 'sort'> & {
      jenisorderId: string;
    },
    db: any,
  ) {
    const sortBy = sort?.sortBy || 'nobukti';
    const sortDirection =
      sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';

    const { orderCol } = this.resolvePositionOrder(sortBy, sortDirection);

    const query = db(`${this.viewName} as u`)
      .select([
        'u.nobukti',
        db.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
        'u.jenisorder_text as jenisorder_nama',
        'u.keterangan',
        'u.biayaemkl_text as biayaemkl_nama',
        'u.modifiedby',
        db.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
        db.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
      ])
      .modify((qb: any) => {
        this.applyPeriodFilters(qb, filters || {}, jenisorderId);
        this.applyFilters(qb, filters || {}, search);
      });

    // Urutan HARUS deterministik: tanpa tiebreak, dua baris dengan nilai sort
    // yang sama bisa bertukar posisi antar-batch cursor.
    query.orderBy(orderCol, sortDirection);
    query.orderBy('u.id', 'asc');

    return query;
  }

  /** Jumlah baris yang akan diekspor — dipakai untuk progres export yang nyata. */
  async countExportRows(
    {
      search,
      filters,
      jenisorderId,
    }: Pick<FindAllParams, 'search' | 'filters'> & { jenisorderId: string },
    db: any,
  ): Promise<number> {
    const result = await db(`${this.viewName} as u`)
      .count('u.id as total')
      .modify((qb: any) => {
        this.applyPeriodFilters(qb, filters || {}, jenisorderId);
        this.applyFilters(qb, filters || {}, search);
      })
      .first();

    return Number(result?.total ?? 0);
  }

  /** Definisi sheet export daftar — dipakai jalur background (streaming). */
  readonly exportSheet = {
    sheetName: 'Data Export',
    titleLines: [
      'PT. TRANSPORINDO AGUNG SEJAHTERA',
      'LAPORAN BIAYA EXTRA',
      'Data Export',
    ],
    headers: [
      'NO.',
      'NO BUKTI',
      'TGL BUKTI',
      'JENIS ORDER',
      'KETERANGAN',
      'BIAYA EMKL',
      'MODIFIED BY',
      'CREATED AT',
      'UPDATED AT',
    ],
    mapRow: (row: any, rowNumber: number) => [
      rowNumber,
      row.nobukti,
      row.tglbukti,
      row.jenisorder_nama,
      row.keterangan,
      row.biayaemkl_nama,
      row.modifiedby,
      row.created_at,
      row.updated_at,
    ],
  };

  async exportToExcel(data: any) {
    const dataHeader = data.data[0];
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:H1');
    worksheet.mergeCells('A2:H2');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN BIAYA EXTRA';

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
      'STATUS TAGIH',
      'NOMINAL TAGIH',
      'KETERANGAN',
      'GROUP BIAYA EXTRA',
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
        row.nominal || 0,
        row.statustagih_nama,
        row.nominaltagih,
        row.keterangan_detail,
        row.groupbiayaextra_nama,
      ];

      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);

        cell.value = value ?? '';
        cell.font = { name: 'Tahoma', size: 10 };

        if (colIndex === 2 || colIndex === 3 || colIndex === 5) {
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
      `laporan_biaya_extra_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
