import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateJurnalumumheaderDto } from './dto/create-jurnalumumheader.dto';
import { UpdateJurnalumumheaderDto } from './dto/update-jurnalumumheader.dto';
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
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { JurnalumumdetailService } from '../jurnalumumdetail/jurnalumumdetail.service';
import { GlobalService } from '../global/global.service';
import { LocksService } from '../locks/locks.service';
import { numberToTerbilang } from 'src/utils/terbilang';
import { Column, Workbook } from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { StatuspendukungService } from '../statuspendukung/statuspendukung.service';
@Injectable()
export class JurnalumumheaderService {
  private readonly logger = new Logger(JurnalumumheaderService.name);

  constructor(
    // Inject wrapper RedisService (BUKAN raw 'REDIS_CLIENT'): set/get/del cache
    // jadi best-effort sehingga create/update tidak gagal 500 "Stream isn't
    // writeable" saat Redis mati. Lihat pengeluaranheader.service.ts.
    private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly jurnalumumdetailService: JurnalumumdetailService,
    private readonly statuspendukungService: StatuspendukungService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
  ) {}
  private readonly tableName = 'jurnalumumheader';
  private readonly viewName = 'vjurnalumumheader';

  private readonly dateFields = ['tglbukti', 'created_at', 'updated_at'];
  private buildInsertData(
    uuid: string | undefined,
    dto: any,
  ): Record<string, any> {
    return {
      id: uuid ? uuid : dto.id ? String(dto.id).toUpperCase() : null,
      nobukti: dto.nobukti ? String(dto.nobukti).toUpperCase() : null,
      tglbukti: dto.tglbukti ? formatDateToSQL(String(dto.tglbukti)) : null,
      keterangan: dto.keterangan ? String(dto.keterangan).toUpperCase() : null,
      postingdari: dto.postingdari
        ? String(dto.postingdari).toUpperCase()
        : null,
      statusformat: dto.statusformat ?? null,
      info: dto.info ?? null,
      modifiedby: dto.modifiedby ? String(dto.modifiedby).toUpperCase() : null,
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
  private resolvePositionOrder(
    sortBy: string,
    sortDirection: string,
  ): { orderCol: string; dir: 'asc' | 'desc' } {
    const dir = sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
    switch (sortBy) {
      case 'statusaktif':
      case 'text':
        return { orderCol: 'u.statusapproval_text', dir };
      case 'statuscetak':
        return { orderCol: 'u.statuscetak_text', dir };
      default:
        // Tanpa fallback, create/update yang dipanggil bersarang (payloadnya
        // tidak membawa sortBy) menghasilkan kolom 'u.undefined'.
        return { orderCol: `u.${sortBy || 'nobukti'}`, dir };
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
  private buildDetailsData(details: any[]): any[] {
    if (!details || details.length === 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Detail jurnal tidak boleh kosong',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    let totalDebet = 0;
    let totalKredit = 0;

    const processedDetails = details.map((detail: any, index: number) => {
      const nominalDebetValue = this.parseCurrency(detail.nominaldebet);
      const nominalKreditValue = this.parseCurrency(detail.nominalkredit);

      if (nominalDebetValue === 0 && nominalKreditValue === 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: `Line ${index + 1}: Nominal Debet atau Kredit harus diisi`,
            error: 'Bad Request',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (nominalDebetValue > 0 && nominalKreditValue > 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: `Line ${index + 1}: Tidak boleh mengisi Debet dan Kredit bersamaan`,
            error: 'Bad Request',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const { nominaldebet, nominalkredit, ...cleanDetail } = detail;

      if (nominalDebetValue > 0) {
        cleanDetail.nominal = nominalDebetValue;
        totalDebet += nominalDebetValue;
      } else if (nominalKreditValue > 0) {
        cleanDetail.nominal = nominalKreditValue * -1;
        totalKredit += nominalKreditValue;
      }

      return cleanDetail;
    });

    const selisih = totalDebet - totalKredit;
    const tolerance = 0.01;

    if (Math.abs(selisih) > tolerance) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: `Jurnal tidak balance! Selisih: ${selisih}`,
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return processedDetails;
  }
  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    const excludeSearchKeys = [
      'tglDari',
      'tglSampai',
      'statusapproval',
      'statuscetak',
    ];

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
      qb.where((query) => {
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
      } else if (key === 'statusapproval' || key === 'statuscetak') {
        // FilterOptions mengirim parameter.id, bukan teks statusnya.
        qb.andWhere(`u.${key}_id`, sanitizedValue);
      } else {
        qb.andWhere(`u.${key}`, 'ilike', `%${sanitizedValue}%`);
      }
    });
  }

  private resolveSortColumn(sortBy: string): string {
    switch (sortBy) {
      case 'statusapproval':
        return 'u.statusapproval_text';
      case 'statuscetak':
        return 'u.statuscetak_text';
      default:
        return `u.${sortBy}`;
    }
  }

  private viewColumns(trx: any) {
    return [
      'u.id',
      'u.nobukti',
      trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
      'u.keterangan',
      'u.postingdari',
      'u.statusformat',
      'u.info',
      'u.modifiedby',
      trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
      trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
      'u.keteranganapproval',
      trx.raw("TO_CHAR(u.tglapproval, 'DD-MM-YYYY HH24:MI:SS') as tglapproval"),
      'u.statusapproval_memo as statusapproval',
      'u.statusapproval_id',
      'u.keterangancetak',
      trx.raw("TO_CHAR(u.tglcetak, 'DD-MM-YYYY HH24:MI:SS') as tglcetak"),
      'u.statuscetak_memo as statuscetak',
      'u.statuscetak_id',
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
      // 1. Ekstrak properti non-insert (pagination, search, dll) dari payload utama
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        details,
        isreload,
        ...dto
      } = data;
      const uuid = await uuidV7(trx);

      // 2. Validasi dan bangun data untuk Details
      const processedDetails = this.buildDetailsData(details);

      // 3. Generate Nomor Bukti Otomatis (jika belum ada)
      if (!dto.nobukti) {
        const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
        const parameter = await trx('parameter')
          .select(
            'grp',
            'subgrp',
            trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
          )
          .where('grp', 'NOMOR PENERIMAAN')
          .andWhere('subgrp', 'NOMOR PENERIMAAN JURNAL')
          .first();

        // Pastikan tglbukti di-set sebelum di-generate running number
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
        dto.postingdari = parameter.memo_nama;
      }

      // 4. Bangun Payload Insert Header menggunakan fungsi helper
      const insertPayload = this.buildInsertData(uuid, dto);

      // 5. INSERT KE TABLE UTAMA (Header)
      // insertPayload sudah membawa uuid dari langkah 1; membungkusnya lagi
      // dengan withUuidV7 akan menimpanya dengan uuid baru, sehingga id yang
      // dipakai menghitung posisi grid di bawah bukan id yang benar-benar
      // tersimpan.
      const insertedItems = await trx(this.tableName)
        .insert(insertPayload)
        .returning('*');

      const newItem = insertedItems[0];

      // 6. INSERT KE TABLE DETAILS
      if (processedDetails && processedDetails.length > 0) {
        const detailsWithNobukti = processedDetails.map((detail: any) => ({
          ...detail,
          nobukti: newItem.nobukti,
          tglbukti: newItem.tglbukti,
          modifiedby: newItem.modifiedby,
        }));
        await this.jurnalumumdetailService.create(
          detailsWithNobukti,
          newItem.id,
          trx,
        );
      }

      await this.statuspendukungService.create(
        this.tableName,
        newItem.id,
        data.modifiedby, // Memakai raw data modifiedby
        trx,
      );

      // Posisi/pagination hanya dipakai grid jurnal umum untuk memfokuskan
      // baris baru. Pemanggilan bersarang mematikannya lewat withGridPosition.
      // Tetap dibungkus try/catch: header + detail sudah tersimpan, jadi gagal
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
            limit,
            sortBy,
            sortDirection,
            filters,
            search,
          );
        } catch (error) {
          this.logger.warn(
            `Gagal menghitung posisi grid jurnal umum: ${error?.message}`,
          );
        }
      }
      // 8. LOG TRAIL
      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD JURNAL UMUM HEADER`,
          idtrans: newItem.id,
          nobuktitrans: newItem.id, // Sesuai kode Anda, walau biasanya nobukti string
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
      data.tglbukti = formatDateToSQL(String(data?.tglbukti)); // Fungsi untuk format

      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        postingdari,
        statusformat,
        details,
        isreload,
        ...insertData
      } = data;

      ['nobukti', 'keterangan', 'postingdari'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });
      const existingData = await trx(this.tableName).where('id', id).first();
      const hasChanges = this.utilsService.hasChanges(insertData, existingData);

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();

        await trx(this.tableName).where('id', id).update(insertData);
      }
      // **HELPER FUNCTION: Parse currency string to number**
      const parseCurrency = (value: any): number => {
        if (value === null || value === undefined || value === '') {
          return 0;
        }
        if (typeof value === 'number') {
          return value;
        }
        if (typeof value === 'string') {
          const cleanValue = value.replace(/[^0-9.-]/g, '');
          const parsed = parseFloat(cleanValue);
          return isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      };

      // **PROSES DETAILS DAN VALIDASI BALANCE**
      if (details && details.length > 0) {
        let totalDebet = 0;
        let totalKredit = 0;

        // Transform details: konversi nominaldebet/nominalkredit menjadi nominal
        const processedDetails = details.map((detail: any, index: number) => {
          // Parse nominal debet dan kredit dari string currency
          const nominalDebetValue = parseCurrency(detail.nominaldebet);
          const nominalKreditValue = parseCurrency(detail.nominalkredit);

          // Validasi: minimal salah satu harus ada nilainya
          if (nominalDebetValue === 0 && nominalKreditValue === 0) {
            throw new HttpException(
              {
                statusCode: HttpStatus.BAD_REQUEST,
                message: `Line ${index + 1}: Nominal Debet atau Kredit harus diisi`,
                error: 'Bad Request',
              },
              HttpStatus.BAD_REQUEST,
            );
          }

          // Validasi: tidak boleh kedua-duanya terisi
          if (nominalDebetValue > 0 && nominalKreditValue > 0) {
            throw new HttpException(
              {
                statusCode: HttpStatus.BAD_REQUEST,
                message: `Line ${index + 1}: Tidak boleh mengisi Debet dan Kredit bersamaan`,
                error: 'Bad Request',
              },
              HttpStatus.BAD_REQUEST,
            );
          }

          // Buat object baru tanpa nominaldebet dan nominalkredit
          const { nominaldebet, nominalkredit, ...cleanDetail } = detail;

          // Set nominal berdasarkan debet atau kredit
          if (nominalDebetValue > 0) {
            cleanDetail.nominal = nominalDebetValue; // Positif untuk debet
            totalDebet += nominalDebetValue;
          } else if (nominalKreditValue > 0) {
            cleanDetail.nominal = nominalKreditValue * -1; // Negatif untuk kredit
            totalKredit += nominalKreditValue;
          }

          return cleanDetail;
        });

        // **VALIDASI BALANCE: Total Debet harus sama dengan Total Kredit**
        const selisih = totalDebet - totalKredit;
        const tolerance = 0.01;

        if (Math.abs(selisih) > tolerance) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: `Jurnal tidak balance!`,
              error: 'Bad Request',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        // Update details dengan yang sudah diproses
        data.details = processedDetails;
      } else {
        // Jika tidak ada details
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Detail jurnal tidak boleh kosong',
            error: 'Bad Request',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Check each detail, update or set id accordingly
      const detailsWithNobukti = data.details.map((detail: any) => ({
        ...detail,
        nobukti: existingData.nobukti, // Inject nobukti into each detail
        modifiedby: insertData.modifiedby,
      }));
      await this.jurnalumumdetailService.create(detailsWithNobukti, id, trx);

      // Ambil baris yang SUDAH diperbarui (tanpa filter) supaya selalu ketemu
      // walau hasil edit tak lagi cocok dengan filter aktif.
      const updatedItem = await trx(`${this.viewName} as u`)
        .select(this.viewColumns(trx))
        .where('u.id', id)
        .first();

      // ── Posisi/pagination pasca-simpan (NON-FATAL) ───────────────────────
      // Header + detail jurnal SUDAH ter-update di atas. Blok di bawah hanya
      // menghitung posisi baris di grid; kegagalannya tidak boleh menggagalkan
      // simpan yang sudah berhasil. Pemanggil internal (alur hutang/penerimaan)
      // mematikannya lewat withGridPosition; default tetap dipertahankan
      // sebagai pengaman untuk pemanggil yang belum mengirim opsi.
      const sortColumn = sortBy || 'nobukti';
      const sortDir = sortDirection || 'asc';
      const pageLimit = Number(limit) > 0 ? Number(limit) : 10;

      let paged: {
        itemIndex: number;
        pageNumber: number;
        fetchedPages: number[];
        pagedData: Record<number, any[]>;
      } = { itemIndex: 0, pageNumber: 1, fetchedPages: [1], pagedData: {} };

      if (withGridPosition) {
        try {
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
            `Update jurnalumumheader ${id} berhasil, tetapi posisi grid pasca-simpan gagal dihitung: ${error?.message}`,
          );
        }
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `EDIT JURNAL UMUM HEADER`,
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      return { updatedItem, ...paged };
    } catch (error) {
      throw new Error(`${error.message}`);
    }
  }
  async delete(id: string, trx: any, modifiedby: string) {
    try {
      // detail & statuspendukung wajib dihapus lebih dulu, header dipegang FK
      // jurnalumumdetail.jurnalumum_id
      const deletedDataDetail = await this.utilsService.lockAndDestroy(
        id,
        'jurnalumumdetail',
        'jurnalumum_id',
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
          postingdari: 'DELETE JURNAL UMUM DETAIL',
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
      console.log('Error deleting data:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }
  /**
   * Data untuk cetak bukti jurnal umum di background: satu header beserta
   * rinciannya, dipetakan ke dua datasource LaporanJurnalUmum.mrt — `data`
   * (header) dan `detail` (rincian coa/nominal).
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

    const detailRes = await this.jurnalumumdetailService.findAll(
      { filters: { nobukti: header.nobukti } },
      db,
    );
    const details = detailRes.data ?? [];

    // `nominal` dari jurnalumumdetail sudah berupa ABS, jadi jumlahnya = debet
    // + kredit — sama dengan Sum(detail.nominal) yang dicetak template, supaya
    // terbilangnya tidak beda dengan angka totalnya. Dijumlahkan dalam satuan
    // sen lalu dibagi 100 supaya sisa pembulatan float tidak menggeser
    // terbilang satu rupiah.
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
          judullaporan: judullaporan ?? 'Laporan Jurnal Umum',
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
   * Query dasar export daftar: filter & sort yang sama dengan findAll, TANPA
   * paging dan hanya kolom yang dipakai file Excel.
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

    const { orderCol } = this.resolvePositionOrder(sortBy, sortDirection);

    const query = db(`${this.viewName} as u`)
      .select([
        'u.nobukti',
        db.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
        'u.keterangan',
        'u.postingdari',
        'u.statusapproval_text',
        'u.statuscetak_text',
        'u.modifiedby',
        db.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
        db.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
      ])
      .modify((qb: any) => this.applyFilters(qb, safeFilters, search));

    // Urutan HARUS deterministik: tanpa tiebreak, dua baris dengan nilai sort
    // yang sama bisa bertukar posisi antar-batch cursor.
    query.orderBy(orderCol, sortDirection);
    query.orderBy('u.id', 'asc');

    return query;
  }

  /** Jumlah baris yang akan diekspor — dipakai untuk progres export yang nyata. */
  async countExportRows(
    { search, filters }: Pick<FindAllParams, 'search' | 'filters'>,
    db: any,
  ): Promise<number> {
    const result = await db(`${this.viewName} as u`)
      .count('u.id as total')
      .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
      .first();

    return Number(result?.total ?? 0);
  }

  /** Definisi sheet export daftar — dipakai jalur background (streaming). */
  readonly exportSheet = {
    sheetName: 'Data Export',
    titleLines: [
      'PT. TRANSPORINDO AGUNG SEJAHTERA',
      'LAPORAN JURNAL UMUM',
      'Data Export',
    ],
    headers: [
      'NO.',
      'NO BUKTI',
      'TGL BUKTI',
      'KETERANGAN',
      'POSTING DARI',
      'STATUS APPROVAL',
      'STATUS CETAK',
      'MODIFIED BY',
      'CREATED AT',
      'UPDATED AT',
    ],
    mapRow: (row: any, rowNumber: number) => [
      rowNumber,
      row.nobukti,
      row.tglbukti,
      row.keterangan,
      row.postingdari,
      row.statusapproval_text,
      row.statuscetak_text,
      row.modifiedby,
      row.created_at,
      row.updated_at,
    ],
  };

  async exportToExcel(data: any[], trx: any) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    // Header laporan
    worksheet.mergeCells('A1:E1');
    worksheet.mergeCells('A2:E2');
    worksheet.mergeCells('A3:E3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN JURNAL UMUM';
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
      const detailRes = await this.jurnalumumdetailService.findAll(
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
        const tableHeaders = [
          'NO.',
          'NO BUKTI',
          'KETERANGAN',
          'COA',
          'NOMINAL DEBET',
          'NOMINAL KREDIT',
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
            d.nobukti ?? '',
            d.keterangan ?? '',
            d.coa ?? '',
            d.nominaldebet ?? '',
            d.nominalkredit ?? '',
          ];
          rowValues.forEach((value, colIndex) => {
            const cell = worksheet.getCell(currentRow, colIndex + 1);
            cell.value = value;
            cell.font = { name: 'Tahoma', size: 10 };

            // kolom angka rata kanan, selain itu rata kiri
            if (colIndex === 3 || colIndex === 4 || colIndex === 5) {
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
      `laporan_jurnal_umum${Date.now()}.xlsx`,
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
          'pengembalianjurnalumumdetail',
          'jurnalumum_nobukti',
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
