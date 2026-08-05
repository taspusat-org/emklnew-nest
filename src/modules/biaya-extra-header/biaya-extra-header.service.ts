import * as fs from 'fs';
import * as path from 'path';
import { Column, Workbook } from 'exceljs';
import { LocksService } from '../locks/locks.service';
import { GlobalService } from '../global/global.service';
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
import { RunningNumberService } from '../running-number/running-number.service';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { BiayaExtraMuatanDetailService } from '../biaya-extra-muatan-detail/biaya-extra-muatan-detail.service';

@Injectable()
export class BiayaExtraHeaderService {
  private readonly tableName: string = 'biayaextraheader';

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly biayaExtraMuatanDetailService: BiayaExtraMuatanDetailService,
  ) {}

  async create(data: any, trx: any) {
    try {
      let detailServiceCreate;
      // Tetap format tanggal DD-MM-YYYY. Uppercase hanya kolom teks manusiawi:
      // jenisorder_id/biayaemkl_id (FK), id, dan status* adalah UUID bertipe
      // text (case-sensitive) yang rusak bila di-uppercase.
      const upperFields = ['keterangan'];
      Object.keys(data).forEach((key) => {
        if (typeof data[key] === 'string') {
          const value = data[key];
          const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

          if (dateRegex.test(value)) {
            data[key] = formatDateToSQL(value);
          } else if (upperFields.includes(key)) {
            data[key] = value.toUpperCase();
          }
        }
      });

      const updated_at = this.utilsService.getTime();
      const created_at = this.utilsService.getTime();
      const getOrderanMuatanId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'MUATAN')
        .first();
      const getOrderanBongkaranId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'BONGKARAN')
        .first();
      const getOrderanImportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'IMPORT')
        .first();
      const getOrderanExportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'EKSPORT')
        .first();
      const getFormatBiayaExtraHeader = await trx('parameter')
        .select('id', 'grp', 'subgrp')
        .where('grp', 'NOMOR EXTRA BIAYA')
        .where('kelompok', 'EXTRA BIAYA')
        .first();

      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        getFormatBiayaExtraHeader.grp,
        getFormatBiayaExtraHeader.subgrp,
        this.tableName,
        data.tglbukti,
      );

      const headerData = {
        nobukti: nomorBukti,
        tglbukti: data.tglbukti,
        jenisorder_id: data.jenisorder_id,
        biayaemkl_id: data.biayaemkl_id,
        keterangan: data.keterangan,
        statusformat: getFormatBiayaExtraHeader.id,
        modifiedby: data.modifiedby,
        created_at,
        updated_at,
      };

      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, headerData))
        .returning('*');
      const newItem = insertedItems[0];

      switch (String(data.jenisorder_id)) {
        case getOrderanMuatanId?.id:
          detailServiceCreate = this.biayaExtraMuatanDetailService;
          break;
        // case getOrderanBongkaranId.id:
        //   detailServiceCreate = 'test';
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          detailServiceCreate = this.biayaExtraMuatanDetailService;
          break;
      }

      if (data.details && data.details.length > 0) {
        const detailsWithNobukti = data.details.map((detail: any) => ({
          id: detail.id || 0,
          nobukti: nomorBukti,
          biayaextra_id: newItem.id,
          orderanmuatan_nobukti: detail.orderanmuatan_nobukti,
          estimasi: detail.estimasi,
          // nominal: detail.nominal,
          statustagih: detail.statustagih,
          nominaltagih: detail.nominaltagih,
          keterangan: detail.keterangan || '',
          groupbiayaextra_id: detail.groupbiayaextra_id,
          modifiedby: newItem.modifiedby,
        }));
        await detailServiceCreate.create(detailsWithNobukti, newItem.id, trx);
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD BL HEADER`,
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      // ── Posisi/pagination pasca-simpan (NON-FATAL) ───────────────────────
      // Header + detail SUDAH ter-insert di atas. Blok ini hanya menghitung
      // posisi/halaman baris baru untuk grid (sama seperti pengeluaranheader).
      // Kegagalannya TIDAK boleh me-rollback simpan yang sudah berhasil.
      let pageNumber = 1;
      let fetchedPages: number[] = [1];
      let pagedData: Record<number, any> = {};
      let itemIndex: any = { zeroBasedIndex: 0 };
      try {
        const { data: filteredItems } = await this.findAll(
          {
            search: data.search,
            filters: {
              ...data.filters,
              jenisOrderan: data.jenisorder_id,
            },
            pagination: { page: data.page, limit: 0 },
            sort: { sortBy: data.sortBy, sortDirection: data.sortDirection },
            isLookUp: false,
          },
          trx,
        );

        let dataIndex = filteredItems.findIndex(
          (item) => item.id === newItem.id,
        );
        if (dataIndex === -1) {
          dataIndex = 0;
        }

        const limit = data.limit || 50;
        const posisi = dataIndex + 1; // posisi 1-based
        const totalPages = Math.ceil(filteredItems.length / limit) || 1;
        pageNumber = Math.ceil(posisi / limit);
        fetchedPages = getFetchedPages(pageNumber, totalPages);
        itemIndex = calculateItemIndex(posisi, fetchedPages, limit);

        fetchedPages.forEach((p) => {
          const start = (p - 1) * limit;
          pagedData[p] = filteredItems.slice(start, start + limit);
        });
        const allFetchedData = fetchedPages.flatMap((p) => pagedData[p]);

        await this.redisService.set(
          `${this.tableName}-page-${pageNumber}`,
          JSON.stringify(allFetchedData),
        );
      } catch (posErr: any) {
        console.warn(
          'biayaextraheader: komputasi posisi pasca-simpan gagal (non-fatal):',
          posErr?.message,
        );
      }

      return {
        newItem,
        itemIndex: itemIndex.zeroBasedIndex < 0 ? 0 : itemIndex.zeroBasedIndex,
        pageNumber,
        fetchedPages,
        pagedData,
      };
    } catch (error) {
      console.error(
        'Error process approval creating biaya extra header in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process approval creating biaya extra header in service',
      );
    }
  }

  /**
   * Jenis order yang sedang dilihat grid. Kalau frontend tidak mengirim
   * filter `jenisOrderan`, default-nya MUATAN — sama seperti tampilan awal
   * grid. Dipakai findAll maupun export supaya keduanya melihat dataset yang
   * PERSIS sama.
   */
  async resolveJenisOrderId(filters: any, trx: any): Promise<string> {
    if (
      filters?.jenisOrderan &&
      filters?.jenisOrderan !== null &&
      filters?.jenisOrderan !== 'null'
    ) {
      return filters.jenisOrderan;
    }

    const orderanMuatan = await trx
      .from(trx.raw(`jenisorder as u`))
      .select('id')
      .where('nama', 'MUATAN')
      .first();

    return orderanMuatan.id;
  }

  /**
   * Search global + filter per kolom + rentang tanggal. Dipisah dari findAll
   * supaya export memakai penyaringan yang sama persis dengan yang tampil di
   * grid — kalau disalin, keduanya pasti berbeda begitu salah satu diubah.
   */
  private applyListFilters(
    query: any,
    filters: Record<string, any> | undefined,
    search: string | undefined,
  ): void {
    if (filters?.tglDari && filters?.tglSampai) {
      const tglDariFormatted = formatDateToSQL(String(filters?.tglDari));
      const tglSampaiFormatted = formatDateToSQL(String(filters?.tglSampai));

      query.whereBetween('u.tglbukti', [tglDariFormatted, tglSampaiFormatted]);
    }

    const excludeSearchKeys = ['tglDari', 'tglSampai', 'jenisOrderan'];
    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );

    if (search) {
      const sanitized = String(search).replace(/\[/g, '[[]').trim();
      query.where((qb) => {
        searchFields.forEach((field) => {
          if (field === 'jenisorder_text') {
            qb.orWhere(`p.nama`, 'like', `%${sanitized}%`);
          } else if (field === 'biayaemkl_text') {
            qb.orWhere(`q.nama`, 'like', `%${sanitized}%`);
          } else if (field === 'tglbukti') {
            qb.orWhereRaw(`TO_CHAR(u.${field}, 'DD-MM-YYYY') LIKE ?`, [
              `%${sanitized}%`,
            ]);
          } else if (field === 'created_at' || field === 'updated_at') {
            qb.orWhereRaw(`TO_CHAR(u.${field}, 'DD-MM-YYYY HH24:MI:SS') LIKE ?`, [
              `%${sanitized}%`,
            ]);
          } else {
            qb.orWhere(`u.${field}`, 'like', `%${sanitized}%`);
          }
        });
      });
    }

    if (filters) {
      Object.entries(filters)
        .filter(([key, value]) => !excludeSearchKeys.includes(key) && value)
        .forEach(([key, value]) => {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          if (key === 'created_at' || key === 'updated_at') {
            query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
              key,
              `%${sanitizedValue}%`,
            ]);
          } else if (key === 'tglbukti') {
            query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY') LIKE ?", [
              key,
              `%${sanitizedValue}%`,
            ]);
          } else if (key === 'jenisorder_text') {
            query.andWhere(`p.nama`, 'like', `%${sanitizedValue}%`);
          } else if (key === 'biayaemkl_text') {
            query.andWhere(`q.nama`, 'like', `%${sanitizedValue}%`);
          } else {
            query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
          }
        });
    }
  }

  async findAll(
    { search, filters, pagination, sort, isLookUp }: FindAllParams,
    trx: any,
  ) {
    try {
      let { page, limit } = pagination ?? {};
      page = page ?? 1;
      limit = limit ?? 0;

      if (isLookUp) {
        const totalData = await trx(this.tableName)
          .count('id as total')
          .first();
        const resultTotalData = totalData?.total || 0;
        if (Number(resultTotalData) > 500) {
          return {
            data: {
              type: 'json',
            },
          };
        } else {
          limit = 0;
        }
      }

      const filtersJenisOrderan = await this.resolveJenisOrderId(filters, trx);

      const query = trx
        .from(trx.raw(`${this.tableName} as u`))
        .select([
          'u.id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.jenisorder_id',
          'u.biayaemkl_id',
          'u.keterangan',
          'u.modifiedby',
          trx.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),

          'p.nama as jenisorder_nama',
          'q.nama as biayaemkl_nama',
        ])
        .leftJoin('jenisorder as p', 'u.jenisorder_id', 'p.id')
        .leftJoin('biayaemkl as q', 'u.biayaemkl_id', 'q.id')
        .where('u.jenisorder_id', filtersJenisOrderan);

      this.applyListFilters(query, filters, search);

      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'jenisorder_text') {
          query.orderBy(`p.nama`, sort.sortDirection);
        } else if (sort?.sortBy === 'biayaemkl_text') {
          query.orderBy('q.nama', sort.sortDirection);
        } else {
          query.orderBy(sort.sortBy, sort.sortDirection);
        }
      }

      const result = await trx(this.tableName).count('id as total').first();
      const total = result?.total as number;
      const totalPages = Math.ceil(total / limit);
      const data = await query;
      const responseType = Number(total) > 500 ? 'json' : 'local';

      return {
        data: data,
        type: responseType,
        total,
        pagination: {
          currentPage: Number(page),
          totalPages: totalPages,
          totalItems: total,
          itemsPerPage: limit > 0 ? limit : total,
        },
      };
    } catch (error) {
      console.error('Error to findAll Biaya Extra Header', error);
      throw new Error(error);
    }
  }

  async findOne(id: string, trx: any) {
    try {
      let detailTableName;
      const checkJenisOrderId = await trx
        .from(trx.raw(`${this.tableName} as u`))
        .select('jenisorder_id')
        .where('id', id)
        .first();
      const getOrderanMuatanId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'MUATAN')
        .first();
      const getOrderanBongkaranId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'BONGKARAN')
        .first();
      const getOrderanImportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'IMPORT')
        .first();
      const getOrderanExportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'EKSPORT')
        .first();

      switch (String(checkJenisOrderId.jenisorder_id)) {
        case getOrderanMuatanId?.id:
          detailTableName = 'biayaextramuatandetail';
          break;
        // case getOrderanBongkaranId.id:
        //   detailTableName = 'biayaextrabongkarandetail';
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          detailTableName = 'biayaextramuatandetail';
          break;
      }

      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.jenisorder_id',
          'u.biayaemkl_id',
          'u.keterangan',
          'jenisorderan.nama as jenisorderan_nama',
          'p.nama as biayaemkl_nama',
          'detail.orderanmuatan_nobukti',
          'detail.estimasi',
          'detail.nominal',
          'detail.statustagih',
          'detail.nominaltagih',
          'detail.keterangan as keterangan_detail',
          'detail.groupbiayaextra_id',
          'parameter.text as statustagih_nama',
          'q.keterangan as groupbiayaextra_nama',
        ])
        .leftJoin(
          'jenisorder as jenisorderan',
          'u.jenisorder_id',
          'jenisorderan.id',
        )
        .leftJoin('biayaemkl as p', 'u.biayaemkl_id', 'p.id')
        .leftJoin(
          `${detailTableName} as detail`,
          'u.id',
          'detail.biayaextra_id',
        )
        .innerJoin('parameter', 'detail.statustagih', 'parameter.id')
        .innerJoin('groupbiayaextra as q', 'detail.groupbiayaextra_id', 'q.id')
        .where('u.id', id);

      const data = await query;
      return {
        data: data,
      };
    } catch (error) {
      console.error(
        'Error fetching data findone biaya extra header by id:',
        error,
      );
      throw new Error('Failed to fetch data findone biaya extra header by id');
    }
  }

  async findOneDetail(id: string, jenisOrderan: number, trx: any) {
    try {
      let detailService;
      const getOrderanMuatanId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'MUATAN')
        .first();
      const getOrderanBongkaranId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'BONGKARAN')
        .first();
      const getOrderanImportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'IMPORT')
        .first();
      const getOrderanExportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'EKSPORT')
        .first();

      switch (jenisOrderan) {
        case getOrderanMuatanId?.id:
          detailService = this.biayaExtraMuatanDetailService;
          break;
        // case getOrderanBongkaranId.id:
        //   detailService = 'biayaextrabongkarandetail';
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          detailService = this.biayaExtraMuatanDetailService;
          break;
      }

      const result = await detailService.findOne(+id, trx);
      return {
        data: result,
      };
    } catch (error) {
      console.error(
        'Error fetching data find one detail biaya extra by id:',
        error,
      );
      throw new Error('Failed to fetch data find one detail biaya extra by id');
    }
  }

  async getDetailByJob(filters: any, trx: any) {
    try {
      let detailService;
      const getOrderanMuatanId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'MUATAN')
        .first();
      const getOrderanBongkaranId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'BONGKARAN')
        .first();
      const getOrderanImportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'IMPORT')
        .first();
      const getOrderanExportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'EKSPORT')
        .first();

      switch (filters?.jenisOrderan) {
        case getOrderanMuatanId?.id:
          detailService = this.biayaExtraMuatanDetailService;
          break;
        // case getOrderanBongkaranId.id:
        //   detailService = 'biayaextrabongkarandetail';
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          detailService = this.biayaExtraMuatanDetailService;
          break;
      }

      const result = await detailService.biayaExraByJob(filters, trx);
      return {
        data: result,
      };
    } catch (error) {
      console.error('Error fetching data find one detail by job:', error);
      throw new Error('Failed to fetch data find one detail by job');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      let updatedData;
      let detailServiceCreate;
      const updated_at = this.utilsService.getTime();
      const getOrderanMuatanId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'MUATAN')
        .first();
      const getOrderanBongkaranId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'BONGKARAN')
        .first();
      const getOrderanImportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'IMPORT')
        .first();
      const getOrderanExportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'EKSPORT')
        .first();

      // Tetap format tanggal DD-MM-YYYY. Uppercase hanya kolom teks manusiawi:
      // jenisorder_id/biayaemkl_id (FK), id, dan status* adalah UUID bertipe
      // text (case-sensitive) yang rusak bila di-uppercase.
      const upperFields = ['keterangan'];
      Object.keys(data).forEach((key) => {
        if (typeof data[key] === 'string') {
          const value = data[key];
          const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

          if (dateRegex.test(value)) {
            data[key] = formatDateToSQL(value);
          } else if (upperFields.includes(key)) {
            data[key] = value.toUpperCase();
          }
        }
      });

      const headerData = {
        nobukti: data.nobukti,
        tglbukti: data.tglbukti,
        jenisorder_id: data.jenisorder_id,
        biayaemkl_id: data.biayaemkl_id,
        keterangan: data.keterangan,
        modifiedby: data.modifiedby,
        updated_at,
      };

      const existingData = await trx(this.tableName).where('id', id).first();
      const hasChanges = this.utilsService.hasChanges(headerData, existingData);

      if (hasChanges) {
        const updated = await trx(this.tableName)
          .where('id', id)
          .update(headerData)
          .returning('*');
        updatedData = updated[0];
      }

      // `updatedData` HANYA terisi bila header benar-benar berubah. Saat user
      // cuma mengubah baris DETAIL (header identik -> hasChanges false), semua
      // akses updatedData.* di bawah melempar TypeError dan seluruh transaksi
      // di-rollback jadi 500, padahal detailnya sah untuk disimpan. Pakai baris
      // yang sudah ada di DB sebagai sumber data header untuk kasus itu.
      const headerRow = updatedData ?? existingData;

      switch (String(data.jenisorder_id)) {
        case getOrderanMuatanId?.id:
          detailServiceCreate = this.biayaExtraMuatanDetailService;
          break;
        // case getOrderanBongkaranId.id:
        //   detailServiceCreate = 'test';
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          detailServiceCreate = this.biayaExtraMuatanDetailService;
          break;
      }

      if (data.details && data.details.length > 0) {
        const detailsWithNobukti = data.details.map((detail: any) => ({
          id: detail.id || 0,
          nobukti: headerRow?.nobukti || data.nobukti,
          biayaextra_id: headerRow?.id || data.id || id,
          orderanmuatan_nobukti: detail.orderanmuatan_nobukti,
          estimasi: detail.estimasi,
          // nominal: detail.nominal,
          statustagih: detail.statustagih,
          nominaltagih: detail.nominaltagih,
          keterangan: detail.keterangan || '',
          groupbiayaextra_id: detail.groupbiayaextra_id,
          modifiedby: headerRow?.modifiedby ?? data.modifiedby,
        }));
        await detailServiceCreate.create(detailsWithNobukti, id, trx);
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `EDIT BIAYA EXTRA HEADER`,
          idtrans: headerRow?.id ?? id,
          nobuktitrans: headerRow?.id ?? id,
          aksi: 'ADD',
          datajson: JSON.stringify([headerRow]),
          modifiedby: headerRow?.modifiedby ?? data.modifiedby,
        },
        trx,
      );

      // ── Posisi/pagination pasca-simpan (NON-FATAL) ───────────────────────
      // Sama seperti create(): hanya menghitung posisi/halaman baris yang
      // diedit untuk grid. Kegagalannya TIDAK boleh me-rollback update yang
      // sudah berhasil.
      let pageNumber = 1;
      let fetchedPages: number[] = [1];
      let pagedData: Record<number, any> = {};
      let itemIndex: any = { zeroBasedIndex: 0 };
      try {
        const { data: filteredItems } = await this.findAll(
          {
            search: data.search,
            filters: {
              ...data.filters,
              jenisOrderan: data.jenisorder_id,
            },
            pagination: { page: data.page, limit: 0 },
            sort: { sortBy: data.sortBy, sortDirection: data.sortDirection },
            isLookUp: false,
          },
          trx,
        );

        let dataIndex = filteredItems.findIndex(
          (item) => item.id === (headerRow?.id ?? id),
        );
        if (dataIndex === -1) {
          dataIndex = 0;
        }

        const limit = data.limit || 50;
        const posisi = dataIndex + 1; // posisi 1-based
        const totalPages = Math.ceil(filteredItems.length / limit) || 1;
        pageNumber = Math.ceil(posisi / limit);
        fetchedPages = getFetchedPages(pageNumber, totalPages);
        itemIndex = calculateItemIndex(posisi, fetchedPages, limit);

        fetchedPages.forEach((p) => {
          const start = (p - 1) * limit;
          pagedData[p] = filteredItems.slice(start, start + limit);
        });
        const allFetchedData = fetchedPages.flatMap((p) => pagedData[p]);

        await this.redisService.set(
          `${this.tableName}-page-${pageNumber}`,
          JSON.stringify(allFetchedData),
        );
      } catch (posErr: any) {
        console.warn(
          'biayaextraheader: komputasi posisi pasca-update gagal (non-fatal):',
          posErr?.message,
        );
      }

      return {
        // headerRow, bukan updatedData: grid memakai `updatedData?.id` untuk
        // mem-fokus ulang baris yang baru disimpan. Kalau hanya detail yang
        // berubah, updatedData undefined -> id null -> fokus lompat ke baris 1.
        updatedData: headerRow,
        itemIndex: itemIndex.zeroBasedIndex < 0 ? 0 : itemIndex.zeroBasedIndex,
        pageNumber,
        fetchedPages,
        pagedData,
      };
    } catch (error) {
      console.error(
        'Error process update biaya extra header in service:',
        error.message,
      );
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
      let detailServiceDelete;
      let detailTableName;
      const checkJenisOrderId = await trx
        .from(trx.raw(`${this.tableName} as u`))
        .select('jenisorder_id')
        .where('id', id)
        .first();
      const getOrderanMuatanId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'MUATAN')
        .first();
      const getOrderanBongkaranId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'BONGKARAN')
        .first();
      const getOrderanImportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'IMPORT')
        .first();
      const getOrderanExportId = await trx
        .from(trx.raw(`jenisorder as u`))
        .select('id')
        .where('nama', 'EKSPORT')
        .first();

      switch (String(checkJenisOrderId.jenisorder_id)) {
        case getOrderanMuatanId?.id:
          detailServiceDelete = this.biayaExtraMuatanDetailService;
          detailTableName = 'biayaextramuatandetail';
          break;
        // case getOrderanBongkaranId.id:
        //   detailServiceDelete = 'test';
        //   detailTableName = 'biayaextrabongkarandetail';
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          detailServiceDelete = this.biayaExtraMuatanDetailService;
          detailTableName = 'biayaextramuatandetail';
          break;
      }

      const checkDataDetail = await trx(detailTableName)
        .select('id')
        .where('biayaextra_id', id);
      if (checkDataDetail && checkDataDetail.length > 0) {
        for (const detail of checkDataDetail) {
          await detailServiceDelete.delete(detail.id, trx, modifiedby);
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
          postingdari: 'DELETE BIAYA EXTRA HEADER',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby.toUpperCase(),
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
        // const validasi = await this.globalService.checkUsed(
        //   'akunpusat',
        //   'type_id',
        //   value,
        //   trx,
        // );
        // return validasi;

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
    const query = db
      .from(db.raw(`${this.tableName} as u`))
      .select([
        'u.nobukti',
        db.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
        'p.nama as jenisorder_nama',
        'u.keterangan',
        'q.nama as biayaemkl_nama',
        'u.modifiedby',
        db.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
        db.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
      ])
      .leftJoin('jenisorder as p', 'u.jenisorder_id', 'p.id')
      .leftJoin('biayaemkl as q', 'u.biayaemkl_id', 'q.id')
      .where('u.jenisorder_id', jenisorderId);

    this.applyListFilters(query, filters, search);

    const sortBy = sort?.sortBy || 'nobukti';
    const sortDirection =
      sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';

    if (sortBy === 'jenisorder_text') {
      query.orderBy('p.nama', sortDirection);
    } else if (sortBy === 'biayaemkl_text') {
      query.orderBy('q.nama', sortDirection);
    } else {
      query.orderBy(sortBy, sortDirection);
    }

    return query;
  }

  /**
   * Jumlah baris yang akan diekspor — dipakai untuk progres export yang
   * sebenarnya. JOIN-nya tetap dipakai karena filter menyaring lewat kolom
   * turunan (p.nama, q.nama).
   */
  async countExportRows(
    {
      search,
      filters,
      jenisorderId,
    }: Pick<FindAllParams, 'search' | 'filters'> & { jenisorderId: string },
    db: any,
  ): Promise<number> {
    const query = db
      .from(db.raw(`${this.tableName} as u`))
      .count('u.id as total')
      .leftJoin('jenisorder as p', 'u.jenisorder_id', 'p.id')
      .leftJoin('biayaemkl as q', 'u.biayaemkl_id', 'q.id')
      .where('u.jenisorder_id', jenisorderId);

    this.applyListFilters(query, filters, search);

    const result = await query.first();
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
    // Mode streaming tidak bisa auto-fit, jadi lebarnya ditetapkan di sini.
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
