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
import { Column, Workbook } from 'exceljs';
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
import { ScheduleDetailService } from '../schedule-detail/schedule-detail.service';
import { ExportSheetDefinition } from 'src/common/report/export-job.service';

@Injectable()
export class ScheduleHeaderService {
  private readonly logger = new Logger(ScheduleHeaderService.name);

  constructor(
    // Inject wrapper RedisService (BUKAN raw 'REDIS_CLIENT'): set/get/del cache
    // jadi best-effort sehingga create/update tidak gagal 500 saat Redis mati.
    private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly scheduleDetailService: ScheduleDetailService,
  ) {}

  // Schedule belum punya view turunan seperti vjurnalumumheader, jadi seluruh
  // query membaca tabelnya langsung dengan alias `u` — bentuk query, filter,
  // dan penghitungan posisi grid tetap sama dengan modul jurnal umum.
  private readonly tableName = 'scheduleheader';
  private readonly viewName = 'scheduleheader';

  private readonly dateFields = ['tglbukti', 'created_at', 'updated_at'];

  private buildInsertData(
    uuid: string | undefined,
    dto: any,
  ): Record<string, any> {
    return {
      id: uuid ? uuid : dto.id ? String(dto.id) : null,
      nobukti: dto.nobukti ? String(dto.nobukti).toUpperCase() : null,
      tglbukti: dto.tglbukti ? formatDateToSQL(String(dto.tglbukti)) : null,
      keterangan: dto.keterangan ? String(dto.keterangan).toUpperCase() : null,
      statusformat: dto.statusformat ?? null,
      info: dto.info ?? null,
      modifiedby: dto.modifiedby ? String(dto.modifiedby).toUpperCase() : null,
      created_at: dto.created_at || this.utilsService.getTime(),
      updated_at: dto.updated_at || this.utilsService.getTime(),
    };
  }

  private resolvePositionOrder(
    sortBy: string,
    sortDirection: string,
  ): { orderCol: string; dir: 'asc' | 'desc' } {
    const dir = sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
    // Tanpa fallback, create/update yang dipanggil bersarang (payloadnya tidak
    // membawa sortBy) menghasilkan kolom 'u.undefined'.
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

  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    const excludeSearchKeys = ['tglDari', 'tglSampai'];

    if (filters?.tglDari && filters?.tglSampai) {
      qb.whereBetween('u.tglbukti', [
        formatDateToSQL(String(filters.tglDari)),
        formatDateToSQL(String(filters.tglSampai)),
      ]);
    }

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
      if (key === 'tglDari' || key === 'tglSampai') return;
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

  private viewColumns(trx: any) {
    return [
      'u.id',
      'u.nobukti',
      trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
      'u.keterangan',
      'u.statusformat',
      'u.info',
      'u.modifiedby',
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
        details,
        isreload,
        method,
        ...dto
      } = data;

      if (!details || details.length === 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Detail schedule tidak boleh kosong',
            error: 'Bad Request',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const uuid = await uuidV7(trx);

      if (!dto.nobukti) {
        const parameter = await trx('parameter')
          .select('grp', 'subgrp')
          .where('grp', 'SCHEDULE')
          .first();

        if (!parameter) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: 'Parameter nomor bukti SCHEDULE belum diatur',
              error: 'Bad Request',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

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
      }

      // insertPayload sudah membawa uuid; membungkusnya lagi dengan withUuidV7
      // akan menimpanya dengan uuid baru sehingga id yang dipakai menghitung
      // posisi grid bukan id yang benar-benar tersimpan.
      const insertedItems = await trx(this.tableName)
        .insert(this.buildInsertData(uuid, dto))
        .returning('*');

      const newItem = insertedItems[0];

      const detailsWithNobukti = details.map((detail: any) => ({
        ...detail,
        nobukti: newItem.nobukti,
        modifiedby: newItem.modifiedby,
      }));
      await this.scheduleDetailService.create(
        detailsWithNobukti,
        newItem.id,
        trx,
      );

      // Posisi/pagination hanya dipakai grid schedule untuk memfokuskan baris
      // baru. Pemanggilan bersarang mematikannya lewat withGridPosition. Tetap
      // dibungkus try/catch: header + detail sudah tersimpan, jadi gagal
      // menghitung posisi tidak boleh me-rollback simpan yang berhasil.
      let paged: Awaited<ReturnType<typeof this.buildPagedResult>> = {
        itemIndex: 0,
        pageNumber: 1,
        fetchedPages: [1],
        pagedData: {},
      };
      if (withGridPosition) {
        try {
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
            `Gagal menghitung posisi grid schedule: ${error?.message}`,
          );
        }
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD SCHEDULE HEADER',
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
      console.error('Error fetching data schedule header:', error);
      throw new Error('Failed to fetch data schedule header');
    }
  }

  async findOne(id: string, trx: any) {
    try {
      const data = await trx(`${this.viewName} as u`)
        .select(this.viewColumns(trx))
        .where('u.id', id);

      return { data };
    } catch (error) {
      console.error('Error fetching data schedule header by id:', error);
      throw new Error('Failed to fetch data schedule header by id');
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
        details,
        isreload,
        method,
        statusformat,
        ...insertData
      } = data;

      if (!details || details.length === 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Detail schedule tidak boleh kosong',
            error: 'Bad Request',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      insertData.tglbukti = formatDateToSQL(String(data?.tglbukti));
      ['nobukti', 'keterangan', 'modifiedby'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      const existingData = await trx(this.tableName).where('id', id).first();
      if (!existingData) {
        throw new NotFoundException(`Schedule dengan id ${id} tidak ditemukan`);
      }

      const hasChanges = this.utilsService.hasChanges(insertData, existingData);
      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(insertData);
      }

      const detailsWithNobukti = details.map((detail: any) => ({
        ...detail,
        nobukti: existingData.nobukti,
        modifiedby: insertData.modifiedby,
      }));
      await this.scheduleDetailService.create(detailsWithNobukti, id, trx);

      // Ambil baris yang SUDAH diperbarui (tanpa filter) supaya selalu ketemu
      // walau hasil edit tak lagi cocok dengan filter aktif.
      const updatedItem = await trx(`${this.viewName} as u`)
        .select(this.viewColumns(trx))
        .where('u.id', id)
        .first();

      // Posisi/pagination pasca-simpan bersifat NON-FATAL: header + detail sudah
      // ter-update, kegagalan menghitung posisi tidak boleh menggagalkannya.
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
            `Update scheduleheader ${id} berhasil, tetapi posisi grid pasca-simpan gagal dihitung: ${error?.message}`,
          );
        }
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT SCHEDULE HEADER',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: insertData.modifiedby,
        },
        trx,
      );

      return { updatedItem, ...paged };
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
      // detail wajib dihapus lebih dulu: header dipegang FK
      // scheduledetail.schedule_id
      const deletedDataDetail = await this.utilsService.lockAndDestroy(
        id,
        'scheduledetail',
        'schedule_id',
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
          postingdari: 'DELETE SCHEDULE HEADER',
          idtrans: deletedData.id,
          nobuktitrans: deletedData.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby,
        },
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: 'scheduledetail',
          postingdari: 'DELETE SCHEDULE DETAIL',
          idtrans: deletedData.id,
          nobuktitrans: deletedData.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedDataDetail),
          modifiedby,
        },
        trx,
      );

      return { status: 200, message: 'Data deleted successfully', deletedData };
    } catch (error) {
      console.error('Error deleting data schedule header:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }

  async checkValidasi(aksi: string, value: any, editedby: any, trx: any) {
    try {
      if (aksi === 'EDIT') {
        return await this.locksService.forceEdit(
          this.tableName,
          value,
          editedby,
          trx,
        );
      }

      if (aksi === 'DELETE') {
        // scheduledetail adalah anak dari header ini dan ikut terhapus, jadi
        // bukan alasan menahan delete. Belum ada modul lain yang memakai
        // nobukti schedule sebagai referensi.
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
   * Data untuk cetak bukti schedule di background: satu header beserta
   * rinciannya, dipetakan ke dua datasource LaporanSchedule.mrt — `data`
   * (header) dan `details` (rincian kapal/jadwal).
   */
  async loadReportData(
    id: string,
    { username, judullaporan }: { username: string; judullaporan?: string },
    db: any,
  ): Promise<Record<string, any[]>> {
    const { data: headerRows } = await this.findOne(id, db);

    if (!headerRows?.length) {
      return { data: [], details: [] };
    }

    const header = headerRows[0];
    const detailRes = await this.scheduleDetailService.findAll(id, db, {
      pagination: { page: 1, limit: 0 },
      sort: { sortBy: 'id', sortDirection: 'asc' },
    });

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const tglcetak =
      `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ` +
      `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    return {
      data: [
        {
          ...header,
          judullaporan: judullaporan ?? 'Laporan Schedule',
          usercetak: username,
          tglcetak,
          judul: 'PT.TRANSPORINDO AGUNG SEJAHTERA',
        },
      ],
      details: detailRes.data ?? [],
    };
  }

  /**
   * Data master satu bukti untuk blok info di atas tabel rincian. Dipakai juga
   * untuk memberi nama file, jadi diambil SEBELUM job export dimulai supaya id
   * yang tidak ada langsung balas 404, bukan gagal di tengah job.
   */
  async loadExportBuktiHeader(id: string, db: any) {
    const header = await db(`${this.viewName} as u`)
      .select(this.viewColumns(db))
      .where('u.id', String(id))
      .first();

    if (!header) {
      throw new NotFoundException(`Schedule dengan id ${id} tidak ditemukan`);
    }

    return header;
  }

  /**
   * Rincian satu bukti. Dikembalikan sebagai query (bukan array) supaya
   * ExportJobService bisa men-stream-nya lewat cursor.
   */
  buildExportBuktiQuery(scheduleId: string, db: any) {
    return this.scheduleDetailService.buildExportQuery(scheduleId, db);
  }

  /** Jumlah baris rincian — dipakai untuk progres export yang nyata. */
  async countExportBuktiRows(scheduleId: string, db: any): Promise<number> {
    return this.scheduleDetailService.countExportRows(scheduleId, db);
  }

  /** Sheet export per transaksi: blok master di atas, rincian di bawah. */
  buildExportBuktiSheet(header: any): ExportSheetDefinition {
    return {
      sheetName: 'Schedule',
      titleLines: [
        'PT. TRANSPORINDO AGUNG SEJAHTERA',
        'LAPORAN SCHEDULE',
        String(header.nobukti ?? ''),
      ],
      infoLines: [
        { label: 'NO BUKTI', value: header.nobukti },
        { label: 'TGL BUKTI', value: header.tglbukti },
        { label: 'KETERANGAN', value: header.keterangan },
      ],
      headers: [
        'NO.',
        'PELAYARAN',
        'KAPAL',
        'TUJUAN KAPAL',
        'TGL BERANGKAT',
        'TGL TIBA',
        'ETB',
        'ETA',
        'ETD',
        'VOY BERANGKAT',
        'VOY TIBA',
        'CLOSING',
        'ETA TUJUAN',
        'ETD TUJUAN',
        'KETERANGAN',
      ],
      mapRow: (row: any, rowNumber: number) => [
        rowNumber,
        row.pelayaran_nama,
        row.kapal_nama,
        row.tujuankapal_nama,
        row.tglberangkat,
        row.tgltiba,
        row.etb,
        row.eta,
        row.etd,
        row.voyberangkat,
        row.voytiba,
        row.closing,
        row.etatujuan,
        row.etdtujuan,
        row.keterangan,
      ],
    };
  }

  async exportToExcel(data: any[], trx: any) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:F1');
    worksheet.mergeCells('A2:F2');
    worksheet.mergeCells('A3:F3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN SCHEDULE';
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
      const detailRes = await this.scheduleDetailService.findAll(h.id, trx, {
        pagination: { page: 1, limit: 0 },
        sort: { sortBy: 'id', sortDirection: 'asc' },
      });
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

      if (details.length === 0) continue;

      const tableHeaders = [
        'NO.',
        'PELAYARAN',
        'KAPAL',
        'TUJUAN KAPAL',
        'TGL BERANGKAT',
        'TGL TIBA',
        'ETB',
        'ETA',
        'ETD',
        'VOY BERANGKAT',
        'VOY TIBA',
        'CLOSING',
        'ETA TUJUAN',
        'ETD TUJUAN',
        'KETERANGAN',
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
          d.pelayaran_nama ?? '',
          d.kapal_nama ?? '',
          d.tujuankapal_nama ?? '',
          d.tglberangkat ?? '',
          d.tgltiba ?? '',
          d.etb ?? '',
          d.eta ?? '',
          d.etd ?? '',
          d.voyberangkat ?? '',
          d.voytiba ?? '',
          d.closing ?? '',
          d.etatujuan ?? '',
          d.etdtujuan ?? '',
          d.keterangan ?? '',
        ];
        rowValues.forEach((value, colIndex) => {
          const cell = worksheet.getCell(currentRow, colIndex + 1);
          cell.value = value;
          cell.font = { name: 'Tahoma', size: 10 };
          cell.alignment = {
            horizontal: colIndex === 0 ? 'center' : 'left',
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
      });

      currentRow += 2;
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
      `laporan_schedule_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
