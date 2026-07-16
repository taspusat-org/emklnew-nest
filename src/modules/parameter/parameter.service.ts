import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateParameterDto } from './dto/create-parameter.dto';
import { UpdateParameterDto } from './dto/update-parameter.dto';
import { dbMssql } from 'src/common/utils/db';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { RedisService } from 'src/common/redis/redis.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { Workbook } from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
@Injectable()
export class ParameterService {
  private readonly tableName = 'parameter';
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  async create(data: any, trx: any) {
    try {
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        ...insertData
      } = data;

      // Uppercase string values
      Object.keys(insertData).forEach((key) => {
        if (typeof insertData[key] === 'string') {
          insertData[key] = insertData[key].toUpperCase();
        }
      });

      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

      const newItem = insertedItems[0];

      // Hapus semua cache yang terkait dengan parameter
      await this.clearParameterCache();

      // Query untuk mencari posisi item baru
      const query = trx(this.tableName)
        .select(
          'id',
          'grp',
          'subgrp',
          'kelompok',
          'text',
          'memo',
          'type',
          'default',
          'modifiedby',
          'info',
          dbMssql.raw(
            "to_char(created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at",
          ),
          dbMssql.raw(
            "to_char(updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at",
          ),
        )
        .orderBy(sortBy ? `${sortBy}` : 'id', sortDirection || 'desc')
        .where('id', '<=', newItem.id);

      // Apply search filter
      if (search) {
        query.where((builder) => {
          builder
            .orWhere('grp', 'ilike', `%${search}%`)
            .orWhere('subgrp', 'ilike', `%${search}%`)
            .orWhere('kelompok', 'ilike', `%${search}%`)
            .orWhere('text', 'ilike', `%${search}%`)
            .orWhere('memo', 'ilike', `%${search}%`)
            .orWhere('type', 'ilike', `%${search}%`)
            .orWhere('default', 'ilike', `%${search}%`)
            .orWhere('modifiedby', 'ilike', `%${search}%`)
            .orWhere('info', 'ilike', `%${search}%`);
        });
      }

      // Apply column filters
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw(
                `to_char(${key}, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?`,
                [`%${value}%`],
              );
            } else {
              query.andWhere(key, 'ilike', `%${value}%`);
            }
          }
        }
      }

      const filteredItems = await query;

      // Find index of new item
      const itemIndex = filteredItems.findIndex(
        (item) => item.id === newItem.id,
      );

      if (itemIndex === -1) {
        throw new Error('Item baru tidak ditemukan di hasil pencarian');
      }

      const pageNumber = Math.floor(itemIndex / limit) + 1;

      // Log trail
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

      return {
        newItem,
        pageNumber,
        itemIndex,
      };
    } catch (error) {
      throw new Error(`Error creating parameter: ${error.message}`);
    }
  }

  async findAll(
    { search, filters, pagination, sort, isLookUp, exclude }: FindAllParams,
    notIn?: any,
  ) {
    try {
      let { page, limit } = pagination ?? {};
      page = page ?? 1;
      limit = limit ?? 0;

      // Generate unique cache key based on query parameters
      const cacheKey = this.generateCacheKey({
        search,
        filters,
        page,
        limit,
        sort,
        isLookUp,
        exclude,
      });
      // Check if data exists in cache. Caching is best-effort: if Redis is
      // unavailable, fall through to the database instead of failing the request
      // with a 500/timeout.
      let cachedData: string | null = null;
      try {
        cachedData = await this.redisService.get(cacheKey);
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
          // Jika data kosong, hapus cache yang tidak valid
          await this.redisService.del(cacheKey);
        } catch {
          // Ignore malformed cache / Redis errors and fall back to the DB.
        }
      }

      // Handle lookup mode
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

      // Query database
      const offset = (page - 1) * limit;
      const query = dbMssql(this.tableName).select(
        'id',
        'grp',
        'subgrp',
        'kelompok',
        'text',
        'memo',
        'type',
        'default',
        'modifiedby',
        'info',
        dbMssql.raw("to_char(created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at"),
        dbMssql.raw("to_char(updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at"),
      );

      if (limit > 0) {
        query.limit(limit).offset(offset);
      }

      // Apply search
      if (search) {
        query.where((builder) => {
          builder.orWhere('text', 'ilike', `%${search}%`);
        });
      }

      // Apply filters
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw(
                `to_char(${key}, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?`,
                [`%${value}%`],
              );
            } else {
              query.andWhere(key, 'ilike', `%${value}%`);
            }
          }
        }
      }

      // Apply exclude filters
      if (exclude && filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value != null) {
            query.andWhere(key, '!=', value);
          }
        }
      }

      // Apply notIn filter - Dinamis untuk semua key
      if (notIn) {
        // Jika notIn adalah string JSON, parse dulu
        const notInObj = typeof notIn === 'string' ? JSON.parse(notIn) : notIn;

        if (notInObj && typeof notInObj === 'object') {
          // Loop semua key di notIn object
          for (const [key, values] of Object.entries(notInObj)) {
            if (Array.isArray(values) && values.length > 0) {
              query.whereNotIn(key, values);
            }
          }
        }
      }
      // Apply sorting
      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }

      // Get total count
      const result = await dbMssql(this.tableName).count('id as total').first();
      const total = result?.total as number;
      const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

      // Execute query
      const parameters = await query;
      const responseType = Number(total) > 500 ? 'json' : 'local';

      // Prepare response
      const responseObject = {
        data: parameters,
        type: responseType,
        total,
        pagination: {
          currentPage: page,
          totalPages: totalPages,
          totalItems: total,
          itemsPerPage: limit,
        },
      };

      // Save to cache with expiration (e.g., 1 hour = 3600 seconds).
      // Best-effort: never let a cache write failure break the response.
      try {
        await this.redisService.set(cacheKey, JSON.stringify(responseObject));
      } catch {
        // ignore — Redis unavailable
      }

      return responseObject;
    } catch (error) {
      console.error('Error fetching parameters:', error);
      throw new Error('Failed to fetch parameters');
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
    } = params;

    // Create a stable string representation of parameters
    const filterStr = JSON.stringify(filters);
    const sortStr = JSON.stringify(sort);

    return `${this.tableName}:list:${search}:${filterStr}:${sortStr}:${page}:${limit}:${isLookUp}:${exclude}`;
  }

  /**
   * Clear all parameter cache
   */
  private async clearParameterCache(): Promise<void> {
    try {
      // Delete all keys matching the pattern
      const pattern = `${this.tableName}:list:*`;
      const deletedCount = await this.redisService.delPattern(pattern);

      if (deletedCount > 0) {
        console.log(
          `Cleared ${deletedCount} cache entries for ${this.tableName}`,
        );
      }

      // Also clear the old allItems cache if exists
      await this.redisService.del(`${this.tableName}-allItems`);
    } catch (error) {
      console.error('Error clearing cache:', error);
      // Don't throw error, just log it
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
              qb.andWhereRaw(`to_char(${key}, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?`, [
                `%${value}%`,
              ]);
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
        dbMssql.raw('[default] AS [default]'),
        'modifiedby',
        'info',
        dbMssql.raw("to_char(created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at"),
        dbMssql.raw("to_char(updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at"),
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
      // Fetch data by id from the database table
      const result = await trx(this.tableName).where('id', id).first();

      // Check if data is found
      if (!result) {
        throw new Error('Data not found');
      }

      return result;
    } catch (error) {
      console.error('Error fetching data by id:', error);
      throw new Error('Failed to fetch data by id');
    }
  }

  async findAllByIds(ids: { id: string }[]) {
    try {
      const idList = ids.map((item) => item.id);
      const tempData = `##temp_${Math.random().toString(36).substring(2, 15)}`;

      // Membuat temporary table
      const createTempTableQuery = `
        CREATE TABLE ${tempData} (
          id NVARCHAR(100)
        );
      `;
      await dbMssql.raw(createTempTableQuery);

      // Memasukkan data ID ke dalam temporary table
      const insertTempTableQuery = `
        INSERT INTO ${tempData} (id)
        VALUES ${idList.map((id) => `('${id}')`).join(', ')};
      `;
      await dbMssql.raw(insertTempTableQuery);

      // Menggunakan alias 'u' untuk tabel utama
      const query = dbMssql(`${this.tableName} AS u`)
        .select(
          'u.id',
          'u.grp',
          'u.subgrp',
          'u.kelompok',
          'u.text',
          'u.memo',
          'u.type',
          'u.default',
          'u.modifiedby',
          'u.info',
          dbMssql.raw(
            "to_char(u.created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at",
          ),
          dbMssql.raw(
            "to_char(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at",
          ),
        )
        .join(dbMssql.raw(`${tempData} AS temp`), 'u.id', 'temp.id') // Memperbaiki JOIN dengan alias yang benar
        .orderBy('u.grp', 'ASC'); // Menambahkan alias 'u' di bagian order by

      const data = await query;

      // Menghapus temporary table setelah query selesai
      const dropTempTableQuery = `DROP TABLE ${tempData};`;
      await dbMssql.raw(dropTempTableQuery);

      return data;
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      const existingData = await trx(this.tableName).where('id', id).first();

      if (!existingData) {
        throw new Error('Parameter not found');
      }

      // Ensure memo is a JSON string
      data.memo = JSON.stringify(data.memo);

      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        statusaktif_text,
        ...insertData
      } = data;

      Object.keys(insertData).forEach((key) => {
        if (typeof insertData[key] === 'string') {
          insertData[key] = insertData[key].toUpperCase();
        }
      });

      const hasChanges = this.utilsService.hasChanges(insertData, existingData);

      // If memo is an object, serialize it to a JSON string
      if (insertData.memo && typeof insertData.memo === 'object') {
        insertData.memo = JSON.stringify(insertData.memo); // Convert object to JSON string
      } else if (insertData.memo === undefined || insertData.memo === null) {
        insertData.memo = ''; // Assign empty string if memo is undefined or null
      }

      if (hasChanges) {
        // Ensure updated_at field is properly set using getTime()
        insertData.updated_at = this.utilsService.getTime();

        await trx(this.tableName).where('id', id).update(insertData);
      }

      const query = trx(this.tableName)
        .select(
          'id',
          'grp',
          'subgrp',
          'kelompok',
          'text',
          'memo',
          'type',
          'default',
          'modifiedby',
          'info',
          dbMssql.raw(
            "to_char(created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at",
          ),
          dbMssql.raw(
            "to_char(updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at",
          ),
        )
        .orderBy(sortBy ? `${sortBy}` : 'id', sortDirection || 'desc')
        .where('id', '<=', id); // Filter based on ID condition

      // Handle search conditions
      if (search) {
        query.where((builder) => {
          builder
            .orWhere('grp', 'ilike', `%${search}%`)
            .orWhere('subgrp', 'ilike', `%${search}%`)
            .orWhere('kelompok', 'ilike', `%${search}%`)
            .orWhere('text', 'ilike', `%${search}%`)
            .orWhere('memo', 'ilike', `%${search}%`)
            .orWhere('type', 'ilike', `%${search}%`)
            .orWhere('default', 'ilike', `%${search}%`)
            .orWhere('modifiedby', 'ilike', `%${search}%`)
            .orWhere('info', 'ilike', `%${search}%`);
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw(
                `to_char(${key}, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?`,
                [`%${value}%`],
              );
            } else {
              query.andWhere(key, 'ilike', `%${value}%`);
            }
          }
        }
      }

      // Fetch filtered items
      const filteredItems = await query;

      const itemIndex = filteredItems.findIndex((item) => item.id === id);

      if (itemIndex === -1) {
        throw new Error('Item not found in search results');
      }

      const pageNumber = Math.floor(itemIndex / limit) + 1;
      const endIndex = pageNumber * limit;

      // Get data for the page
      const limitedItems = filteredItems.slice(0, endIndex);

      // Store the result in Redis
      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT PARAMETER',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      return {
        newItem: {
          id,
          ...data,
        },
        pageNumber,
        itemIndex,
      };
    } catch (error) {
      console.error('Error updating parameter:', error);
      throw new Error('Failed to update parameter');
    }
  }

  async delete(id: string, trx: any) {
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
          postingdari: 'DELETE PARAMETER',
          idtrans: deletedData.id,
          nobuktitrans: deletedData.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: deletedData.modifiedby,
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

  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    // Header export
    worksheet.mergeCells('A1:F1');
    worksheet.mergeCells('A2:F2');
    worksheet.mergeCells('A3:F3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN PARAMETER';
    worksheet.getCell('A3').value = 'Data Export';
    worksheet.getCell('A1').alignment = {
      horizontal: 'center',
      vertical: 'middle',
    };
    worksheet.getCell('A2').alignment = {
      horizontal: 'center',
      vertical: 'middle',
    };
    worksheet.getCell('A3').alignment = {
      horizontal: 'center',
      vertical: 'middle',
    };
    worksheet.getCell('A1').font = { size: 14, bold: true };
    worksheet.getCell('A2').font = { bold: true };
    worksheet.getCell('A3').font = { bold: true };

    // Mendefinisikan header kolom
    const headers = [
      'No.',
      'GROUP',
      'SUB GROUP',
      'KELOMPOK',
      'TEXT',
      'MEMO',
      'CREATED AT',
    ];
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

    // Mengisi data ke dalam Excel dengan nomor urut sebagai ID
    data.forEach((row, rowIndex) => {
      worksheet.getCell(rowIndex + 6, 1).value = rowIndex + 1; // Nomor urut (ID)
      worksheet.getCell(rowIndex + 6, 2).value = row.grp;
      worksheet.getCell(rowIndex + 6, 3).value = row.subgrp;
      worksheet.getCell(rowIndex + 6, 4).value = row.kelompok;
      worksheet.getCell(rowIndex + 6, 5).value = row.text;
      worksheet.getCell(rowIndex + 6, 6).value = row.memo;
      worksheet.getCell(rowIndex + 6, 7).value = row.created_at;

      // Menambahkan border untuk setiap cell
      for (let col = 1; col <= headers.length; col++) {
        const cell = worksheet.getCell(rowIndex + 6, col);
        cell.font = { name: 'Tahoma', size: 10 };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      }
    });

    // Mengatur lebar kolom
    worksheet.getColumn(1).width = 10; // Lebar untuk nomor urut
    worksheet.getColumn(2).width = 30;
    worksheet.getColumn(3).width = 30;
    worksheet.getColumn(4).width = 30;
    worksheet.getColumn(5).width = 15;
    worksheet.getColumn(6).width = 20;
    worksheet.getColumn(7).width = 30;

    // Simpan file Excel ke direktori sementara
    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_parameter${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath; // Kembalikan path file sementara
  }
}
