import {
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { dbMssql } from 'src/common/utils/db';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import {
  calculateItemIndex,
  getFetchedPages,
  UtilsService,
  uuidV7,
} from 'src/utils/utils.service';
import { RedisService } from 'src/common/redis/redis.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { LocksService } from '../locks/locks.service';
import { Workbook, Column } from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ParameterService {
  private readonly logger = new Logger(ParameterService.name);
  private readonly tableName = 'parameter';

  /** Kolom teks manusiawi yang di-uppercase sebelum disimpan. */
  private readonly upperCaseFields = [
    'grp',
    'subgrp',
    'kelompok',
    'text',
    'type',
    'default',
  ];

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly locksService: LocksService,
  ) {}

  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    const dateFields = ['created_at', 'updated_at'];
    // memo & info bertipe text — dikecualikan dari search global supaya
    // pencarian tidak menyapu seluruh isi JSON memo.
    const searchFields = [
      'grp',
      'subgrp',
      'kelompok',
      'text',
      'type',
      'default',
      'modifiedby',
    ];

    if (search) {
      const sanitizedValue = String(search).trim();
      qb.where((query: any) => {
        searchFields.forEach((field) => {
          query.orWhere(`p.${field}`, 'ilike', `%${sanitizedValue}%`);
        });
      });
    }

    Object.entries(filters || {}).forEach(([key, rawValue]) => {
      if (rawValue === null || rawValue === undefined || rawValue === '')
        return;

      const sanitizedValue = String(rawValue);
      if (dateFields.includes(key)) {
        qb.andWhereRaw("TO_CHAR(p.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else {
        qb.andWhere(`p.${key}`, 'ilike', `%${sanitizedValue}%`);
      }
    });
  }

  private buildInsertData(dto: any, uuid?: string): Record<string, any> {
    const data: Record<string, any> = {
      id: uuid ? uuid : dto.id,
      grp: dto.grp ?? null,
      subgrp: dto.subgrp ?? null,
      kelompok: dto.kelompok ?? null,
      text: dto.text ?? null,
      // memo datang dari form sebagai objek key/value; kolomnya bertipe text.
      memo:
        dto.memo && typeof dto.memo === 'object'
          ? JSON.stringify(dto.memo)
          : (dto.memo ?? null),
      type: dto.type ?? null,
      default: dto.default ?? null,
      info: dto.info ?? null,
      modifiedby: dto.modifiedby ? String(dto.modifiedby).toUpperCase() : '',
      created_at: dto.created_at || this.utilsService.getTime(),
      updated_at: dto.updated_at || this.utilsService.getTime(),
    };

    this.upperCaseFields.forEach((field) => {
      if (typeof data[field] === 'string') {
        data[field] = data[field].toUpperCase();
      }
    });

    return data;
  }

  private resolvePositionOrder(
    sortBy: string,
    sortDirection: string,
  ): { orderCol: string; dir: 'asc' | 'desc' } {
    const dir = sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
    return { orderCol: `p.${sortBy}`, dir };
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

    const existingData = await trx(`${this.tableName} as p`)
      .select({ posval: orderCol })
      .where('p.id', id)
      .modify((qb: any) => this.applyFilters(qb, filters, search))
      .first();
    if (!existingData || existingData.posval === null) return 1;

    const resultposition = await trx(`${this.tableName} as p`)
      .count('* as posisi')
      .where(orderCol, dir === 'desc' ? '>=' : '<=', existingData.posval)
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

    // trx WAJIB diteruskan: dipanggil dari dalam transaksi create/update, jadi
    // window harus dibaca lewat koneksi yang sama supaya baris yang baru
    // disimpan (belum commit) ikut terlihat.
    const result = await this.findAll(
      {
        search: search || '',
        filters: filters || {},
        pagination: { page: startPage, limit: totalDataNeeded, customOffset },
        sort: { sortBy, sortDirection: sortDirection as 'asc' | 'desc' },
        isLookUp: false,
        useCustomOffset: true,
      },
      undefined,
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
      const { sortBy, sortDirection, filters, search, limit } = data;

      const sortColumn = sortBy || 'grp';
      const sortDir = sortDirection || 'asc';
      const pageLimit = Number(limit) > 0 ? Number(limit) : 10;

      const uuid = await uuidV7(trx);
      const insertData = this.buildInsertData(data, uuid);
      await trx(this.tableName).insert(insertData);

      const newItem = await trx(this.tableName).where('id', uuid).first();

      // Cache list dibersihkan SEBELUM posisi dihitung supaya window yang
      // dirakit buildPagedResult tidak diambil dari hasil pra-insert.
      await this.clearParameterCache();

      const totalRecords = await trx(`${this.tableName} as p`)
        .count('p.id as total')
        .modify((qb: any) => this.applyFilters(qb, filters, search))
        .first();
      const totalItems = Number(totalRecords?.total ?? 0);

      const posisi = await this.resolvePosition(
        trx,
        uuid,
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

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD PARAMETER',
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
      this.logger.error('Error creating parameter', error?.stack);
      throw new InternalServerErrorException('Gagal menyimpan parameter');
    }
  }

  async findAll(
    {
      search,
      filters,
      pagination,
      sort,
      isLookUp,
      exclude,
      useCustomOffset,
    }: FindAllParams,
    notIn?: any,
    db: any = dbMssql,
  ) {
    try {
      const { page = 1, customOffset } = pagination ?? {};
      let limit = pagination?.limit ?? 0;
      // Jalur buildPagedResult berjalan di dalam transaksi tulis: hasilnya
      // belum commit, jadi tidak boleh dibaca dari maupun ditulis ke cache list.
      const useCache = useCustomOffset !== true;

      const sortBy = sort?.sortBy || 'grp';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
      const safeFilters = (filters || {}) as Record<string, any>;

      const cacheKey = this.generateCacheKey({
        search,
        filters: safeFilters,
        page,
        limit,
        sort: { sortBy, sortDirection },
        isLookUp,
        exclude,
        notIn,
        customOffset: useCustomOffset ? customOffset : undefined,
      });
      // Caching best-effort: kalau Redis mati, jatuh ke database daripada
      // menggagalkan request.
      let cachedData: string | null = null;
      try {
        cachedData = useCache ? await this.redisService.get(cacheKey) : null;
      } catch {
        cachedData = null;
      }
      if (cachedData) {
        try {
          const parsedCache = JSON.parse(cachedData);
          if (
            parsedCache.data &&
            Array.isArray(parsedCache.data) &&
            parsedCache.data.length > 0
          ) {
            return parsedCache;
          }
          await this.redisService.del(cacheKey);
        } catch {
          // Abaikan cache rusak / Redis error, lanjut ke DB.
        }
      }

      // Gate lookup memakai jumlah baris TANPA filter — perilaku ini dipakai
      // ~50 halaman lookup lain, jangan diubah bersama perbaikan paging.
      if (isLookUp) {
        const acoCountResult = await db(this.tableName)
          .count('id as total')
          .first();

        const acoCount = acoCountResult?.total || 0;

        if (Number(acoCount) > 500) {
          return { data: { type: 'json' } };
        }
        limit = 0;
      }

      const applyScope = (qb: any) => {
        this.applyFilters(qb, safeFilters, search);

        if (exclude && filters) {
          for (const [key, value] of Object.entries(safeFilters)) {
            if (value != null) {
              qb.andWhere(`p.${key}`, '!=', value);
            }
          }
        }

        if (notIn) {
          const notInObj =
            typeof notIn === 'string' ? JSON.parse(notIn) : notIn;

          if (notInObj && typeof notInObj === 'object') {
            for (const [key, values] of Object.entries(notInObj)) {
              if (Array.isArray(values) && values.length > 0) {
                qb.whereNotIn(`p.${key}`, values);
              }
            }
          }
        }
      };

      // totalItems dihitung DENGAN filter aktif; sebelumnya memakai COUNT
      // seluruh tabel sehingga jumlah halaman grid salah begitu difilter dan
      // buildPagedResult menghitung posisi baris pada window yang keliru.
      const countResult = await db(`${this.tableName} as p`)
        .count('p.id as total')
        .modify(applyScope)
        .first();
      const total = Number(countResult?.total ?? 0);

      const query = db(`${this.tableName} as p`).select(
        'p.id',
        'p.grp',
        'p.subgrp',
        'p.kelompok',
        'p.text',
        'p.memo',
        'p.type',
        'p.default',
        'p.modifiedby',
        'p.info',
        db.raw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at"),
        db.raw("TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at"),
      );

      query.modify(applyScope);

      const { orderCol } = this.resolvePositionOrder(sortBy, sortDirection);
      query.orderBy(orderCol, sortDirection);

      const offset =
        useCustomOffset === true && customOffset !== undefined
          ? customOffset
          : (page - 1) * limit;

      if (limit > 0) {
        query.offset(offset).limit(limit);
      }

      const parameters = await query;
      const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
      const responseType = total > 500 ? 'json' : 'local';

      const responseObject = {
        data: parameters,
        type: responseType,
        total,
        pagination: {
          currentPage: Number(page),
          totalPages,
          totalItems: total,
          itemsPerPage: limit,
        },
      };

      if (useCache) {
        try {
          await this.redisService.set(cacheKey, JSON.stringify(responseObject));
        } catch {
          // ignore — Redis unavailable
        }
      }

      return responseObject;
    } catch (error) {
      this.logger.error('Error fetching parameters', error?.stack);
      throw new InternalServerErrorException('Failed to fetch data');
    }
  }

  /**
   * Generate unique cache key based on query parameters
   */
  private generateCacheKey(params: any): string {
    const {
      search = '',
      filters = {},
      page = 1,
      limit = 0,
      sort = {},
      isLookUp = false,
      exclude = false,
      notIn = null,
      customOffset,
    } = params;

    const filterStr = JSON.stringify(filters);
    const sortStr = JSON.stringify(sort);
    const notInStr = notIn ? JSON.stringify(notIn) : '';

    return `${this.tableName}:list:${search}:${filterStr}:${sortStr}:${page}:${limit}:${isLookUp}:${exclude}:${notInStr}:${customOffset ?? ''}`;
  }

  /**
   * Clear all parameter cache
   */
  private async clearParameterCache(): Promise<void> {
    try {
      const pattern = `${this.tableName}:list:*`;
      await this.redisService.delPattern(pattern);
      await this.redisService.del(`${this.tableName}-allItems`);
    } catch (error) {
      this.logger.warn(`Gagal membersihkan cache parameter: ${error?.message}`);
    }
  }

  async findAllApproval({
    search,
    filters,
    pagination,
    sort,
    isLookUp,
  }: FindAllParams) {
    try {
      let { page, limit } = pagination ?? {};
      page = page ?? 1;
      limit = limit ?? 0; // 0 = tanpa paging

      // Early lookup size gate (mengikuti pola awal)
      if (isLookUp) {
        const acoCountResult = await dbMssql(this.tableName)
          .count('id as total')
          .first();
        const acoCount = acoCountResult?.total || 0;
        if (Number(acoCount) > 500) {
          return { data: { type: 'json' } };
        } else {
          limit = 0;
        }
      }

      const offset = (page - 1) * (limit || 0);

      // ==== Helper & konstanta ====
      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)'; // penting: TEXT/NTEXT -> text

      const escapeJsonKey = (k: string) => String(k).replace(/"/g, '\\"');

      // Terapkan kondisi umum (search + filters) ke sebuah builder
      const attachCommonConditions = (qb: any) => {
        // Pastikan hanya baris dengan JSON valid
        qb.whereRaw(`(${memoExpr} IS JSON)`);

        // Search ke kolom text + seluruh nilai JSON
        if (search) {
          qb.andWhere((builder: any) => {
            builder.orWhere('text', 'ilike', `%${search}%`).orWhereRaw(
              `EXISTS (
                   SELECT 1
                   FROM jsonb_each_text(${memoExpr}) j2
                   WHERE j2.value ILIKE ?
                 )`,
              [`%${search}%`],
            );
          });
        }

        // Filters
        if (filters) {
          for (const [key, value] of Object.entries(filters)) {
            if (!value) continue;

            if (key === 'created_at' || key === 'updated_at') {
              qb.andWhereRaw(
                `to_char(${key}, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?`,
                [`%${value}%`],
              );
            } else if (key === 'json') {
              // filters.json = { "SINGKATAN":"BIAYA", "NILAI YA":"12" }
              if (value && typeof value === 'object') {
                for (const [jk, jv] of Object.entries(
                  value as Record<string, string>,
                )) {
                  const safeKey = escapeJsonKey(jk);
                  qb.andWhereRaw(
                    `JSON_VALUE(${memoExpr}, '$."${safeKey}"') ILIKE ?`,
                    [`%${jv}%`],
                  );
                }
              }
            } else {
              // kolom biasa
              qb.andWhere(key, 'ilike', `%${value}%`);
            }
          }
        }
      };

      // ==== Query DATA ====
      const dataQuery = dbMssql(this.tableName).select(
        'id',
        'grp',
        'subgrp',
        'kelompok',
        'text',
        'memo', // JSON mentah
        dbMssql.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
        dbMssql.raw(`JSON_VALUE(${memoExpr}, '$.SINGKATAN') AS singkatan`),
        dbMssql.raw(`JSON_VALUE(${memoExpr}, '$.WARNA') AS warna`),
        dbMssql.raw(
          `JSON_VALUE(${memoExpr}, '$.WARNATULISAN') AS warna_tulisan`,
        ),
        dbMssql.raw(`JSON_VALUE(${memoExpr}, '$."NILAI YA"') AS nilai_ya`),
        dbMssql.raw(
          `JSON_VALUE(${memoExpr}, '$."NILAI TIDAK"') AS nilai_tidak`,
        ),
        dbMssql.raw(`JSON_VALUE(${memoExpr}, '$."ROLE YA"') AS role_ya`),
        dbMssql.raw(`JSON_VALUE(${memoExpr}, '$."ROLE TIDAK"') AS role_tidak`),
        dbMssql.raw(
          `JSON_VALUE(${memoExpr}, '$."KETERANGAN WAJIB ISI"') AS keterangan_wajib_isi`,
        ),
        dbMssql.raw(
          `JSON_VALUE(${memoExpr}, '$."TANGGAL WAJIB ISI"') AS tanggal_wajib_isi`,
        ),
        dbMssql.raw(`JSON_VALUE(${memoExpr}, '$."ICON"') AS icon`),
        'type',
        // `default` kata kunci SQL sehingga harus dikutip. Sebelumnya memakai
        // kurung siku ala SQL Server ([default]) yang di Postgres adalah
        // syntax error -> seluruh endpoint /parameter/approval balas 500.
        dbMssql.raw('"default" AS "default"'),
        'modifiedby',
        'info',
        dbMssql.raw(
          "to_char(created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at",
        ),
        dbMssql.raw(
          "to_char(updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at",
        ),
      );

      attachCommonConditions(dataQuery);

      // Sorting (biarkan pakai alias; SQL Server mendukung ORDER BY alias di SELECT atas)
      if (sort?.sortBy && sort?.sortDirection) {
        dataQuery.orderBy(sort.sortBy, sort.sortDirection);
      }

      if (limit > 0) {
        dataQuery.limit(limit).offset(offset);
      }

      // ==== Query COUNT (pakai kondisi yang sama) ====
      const countQuery = dbMssql(this.tableName).count('id as total');
      attachCommonConditions(countQuery);
      const countRes = await countQuery.first();
      const total = Number(countRes?.total ?? 0);
      const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

      // ==== Eksekusi DATA ====
      const parameters = await dataQuery;

      // ==== Bentuk respons + cache ====
      const responseType = total > 500 ? 'json' : 'local';
      const responseObject = {
        data: parameters,
        type: responseType,
        total,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems: total,
          itemsPerPage: limit,
        },
      };

      return responseObject;
    } catch (error) {
      console.error('Error fetching parameters:', error);
      throw new Error('Failed to fetch parameters');
    }
  }

  async getById(id: string, trx: any) {
    try {
      const result = await trx(this.tableName).where('id', id).first();

      if (!result) {
        throw new NotFoundException('Parameter tidak ditemukan');
      }

      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Error fetching parameter by id', error?.stack);
      throw new InternalServerErrorException('Failed to fetch data by id');
    }
  }

  async findAllByIds(ids: { id: string }[]) {
    try {
      const idList = ids.map((item) => item.id);

      const data = await dbMssql(`${this.tableName} as p`)
        .select(
          'p.id',
          'p.grp',
          'p.subgrp',
          'p.kelompok',
          'p.text',
          'p.memo',
          'p.type',
          'p.default',
          'p.modifiedby',
          'p.info',
          dbMssql.raw(
            "TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at",
          ),
          dbMssql.raw(
            "TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at",
          ),
        )
        .whereIn('p.id', idList)
        .orderBy('p.grp', 'ASC');

      return data;
    } catch (error) {
      this.logger.error('Error fetching parameter by ids', error?.stack);
      throw new InternalServerErrorException('Failed to fetch data');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      const existedData = await trx(this.tableName).where('id', id).first();

      if (!existedData) {
        throw new NotFoundException('Parameter tidak ditemukan');
      }

      const { sortBy, sortDirection, filters, search, limit } = data;

      const sortColumn = sortBy || 'grp';
      const sortDir = sortDirection || 'asc';
      const pageLimit = Number(limit) > 0 ? Number(limit) : 10;

      const insertData = this.buildInsertData(data);
      // id = kunci WHERE (PK), bukan kolom yang di-SET. created_at juga jangan
      // ditimpa saat edit (buildInsertData mengisinya dengan now() bila kosong).
      delete insertData.id;
      delete insertData.created_at;

      const hasChanges = this.utilsService.hasChanges(insertData, existedData);

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(insertData);
      }

      await this.clearParameterCache();

      // Ambil baris yang SUDAH diperbarui (tanpa filter) supaya selalu ketemu
      // walau hasil edit tak lagi cocok dengan filter aktif.
      const updatedItem = await trx(this.tableName).where('id', id).first();

      const totalRecords = await trx(`${this.tableName} as p`)
        .count('p.id as total')
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

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT PARAMETER',
          idtrans: updatedItem.id,
          nobuktitrans: updatedItem.id,
          aksi: 'EDIT',
          datajson: JSON.stringify(updatedItem),
          modifiedby: updatedItem.modifiedby,
        },
        trx,
      );

      return { updatedItem, ...paged };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Error updating parameter', error?.stack);
      throw new InternalServerErrorException('Gagal memperbarui parameter');
    }
  }

  async delete(id: string, trx: any, modifiedby?: string) {
    try {
      // lockAndDestroy mengembalikan `true` (bukan melempar) saat baris tidak
      // ada, sehingga tanpa cek ini penghapusan id asing tetap dibalas 200 dan
      // logtrail-nya tercatat dengan idtrans undefined.
      const existedData = await trx(this.tableName).where('id', id).first();
      if (!existedData) {
        throw new NotFoundException('Parameter tidak ditemukan');
      }

      const deletedData = await this.utilsService.lockAndDestroy(
        id,
        this.tableName,
        'id',
        trx,
      );

      await this.clearParameterCache();

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE PARAMETER',
          idtrans: deletedData.id,
          nobuktitrans: deletedData.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby ?? deletedData.modifiedby,
        },
        trx,
      );

      return { status: 200, message: 'Data deleted successfully', deletedData };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Error deleting parameter', error?.stack);
      throw new InternalServerErrorException('Failed to delete data');
    }
  }

  async validateRows(rows: { key: string; value: string }[]) {
    const errors: { rowIndex: number; message: string }[] = [];

    for (const [index, row] of rows.entries()) {
      const { key, value } = row;

      if (!key.trim() || !value.trim()) {
        // Ambil pesan error dari database berdasarkan kode 'WI'
        const errorMessage = await dbMssql('error')
          .select('ket')
          .where('kode', 'WI')
          .first();

        errors.push({
          rowIndex: index,
          message: errorMessage?.keterangan || 'Key dan Value wajib diisi',
        });
      }
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    return { success: true };
  }

  /**
   * Pra-cek sebelum dialog dibuka.
   *
   * EDIT mengambil lock baris seperti modul master lainnya. DELETE tidak punya
   * satu tabel referensi untuk dicek: id parameter dipakai sebagai `statusaktif`
   * (dan kolom sejenis) di hampir seluruh tabel, jadi tidak ada analog
   * `checkUsed` bertabel-tunggal seperti groupbiayaextra.
   */
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

      return { status: 'success', message: 'Data aman untuk dihapus.' };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Error di checkValidasi parameter', error?.stack);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }

  /** Kolom yang benar-benar dipakai file export — bukan seluruh kolom grid. */
  private readonly EXPORT_COLUMNS = [
    'p.grp',
    'p.subgrp',
    'p.kelompok',
    'p.text',
    'p.type',
    'p.default',
  ];

  /**
   * Query dasar export: filter & sort yang sama dengan findAll, TANPA paging
   * dan hanya kolom yang dipakai file Excel.
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
    const sortBy = sort?.sortBy || 'grp';
    const sortDirection =
      sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';

    const { orderCol } = this.resolvePositionOrder(sortBy, sortDirection);

    return db(`${this.tableName} as p`)
      .select(this.EXPORT_COLUMNS)
      .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
      .orderBy(orderCol, sortDirection);
  }

  /**
   * Jumlah baris yang akan diekspor — dipakai untuk progres export yang
   * sebenarnya.
   */
  async countExportRows(
    { search, filters }: Pick<FindAllParams, 'search' | 'filters'>,
    db: any,
  ): Promise<number> {
    const result = await db(`${this.tableName} as p`)
      .count('p.id as total')
      .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
      .first();

    return Number(result?.total ?? 0);
  }

  /** Definisi sheet export — dipakai jalur background (streaming). */
  readonly exportSheet = {
    sheetName: 'Data Export',
    titleLines: [
      'PT. TRANSPORINDO AGUNG SEJAHTERA',
      'LAPORAN PARAMETER',
      'Data Export',
    ],
    headers: [
      'NO.',
      'GROUP',
      'SUB GROUP',
      'KELOMPOK',
      'TEXT',
      'TYPE',
      'DEFAULT',
    ],
    columnWidths: [6, 25, 25, 25, 30, 15, 15],
    mapRow: (row: any, rowNumber: number) => [
      rowNumber,
      row.grp,
      row.subgrp,
      row.kelompok,
      row.text,
      row.type,
      row.default,
    ],
  };

  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:G1');
    worksheet.mergeCells('A2:G2');
    worksheet.mergeCells('A3:G3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN PARAMETER';
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

    const headers = this.exportSheet.headers;

    headers.forEach((header, index) => {
      const cell = worksheet.getCell(5, index + 1);
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

    data.forEach((row, rowIndex) => {
      const currentRow = rowIndex + 6;
      const rowValues = this.exportSheet.mapRow(row, rowIndex + 1);
      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);
        cell.value = value ?? '';
        cell.font = { name: 'Tahoma', size: 10 };
        cell.alignment = {
          horizontal: colIndex === 0 ? 'right' : 'left',
          vertical: 'middle',
        };
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
      .forEach((col, index) => {
        col.width = this.exportSheet.columnWidths[index] ?? 20;
      });

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_parameter_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
