import {
  Inject,
  Injectable,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import {
  calculateItemIndex,
  extractFetchedPageData,
  getFetchedPages,
  splitDataByPages,
  UtilsService,
} from 'src/utils/utils.service';
import { RedisService } from 'src/common/redis/redis.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import * as fs from 'fs';
import * as path from 'path';
import { Column, Workbook } from 'exceljs';
@Injectable()
export class AkunpusatService {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
  ) {}
  private readonly tableName = 'akunpusat';
  async create(createAkunpusatDto: any, trx: any) {
    try {
      const {
        sortBy,
        id,
        sortDirection,
        filters,
        search,
        page,
        limit,
        parent_nama,
        statusaktif_nama,
        cabang_nama,
        type_nama,
        ...insertData
      } = createAkunpusatDto;

      insertData.updated_at = this.utilsService.getTime();
      insertData.created_at = this.utilsService.getTime();

      // Normalize the data (e.g., convert strings to uppercase)
      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['coa', 'keterangancoa', 'parent'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      // Insert the new item
      const insertedItems = await trx(this.tableName)
        .insert(insertData)
        .returning('*');

      const newItem = insertedItems[0]; // Get the inserted item

      // Get all data to find the position of new item
      const { data: allData } = await this.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false,
        },
        trx,
      );

      // If there is no data, skip creating the temp table and return minimal result
      if (!allData || allData.length === 0) {
        // Cache empty result
        await this.redisService.set(
          `${this.tableName}-allItems`,
          JSON.stringify([]),
        );

        // Log the creation action
        await this.logTrailService.create(
          {
            namatabel: this.tableName,
            postingdari: 'ADD CONTAINER',
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
          itemIndex: 0,
          fetchedPages: [],
          pagedData: {},
        };
      }

      // Create temporary table and insert data using utility method
      const { tempTableName } = await this.utilsService.createTempTableFromData(
        allData,
        trx,
        this.tableName,
      );

      // Get position from temporary table (ini adalah posisi global dari SEMUA data, 1-based)
      const positionResult = await trx(tempTableName)
        .select('position', '__total_items')
        .where('id', newItem.id)
        .first();

      // Posisi global
      const itemPosition = positionResult?.position ?? 0;

      // Hitung page berdasarkan limit
      const pageNumber = limit > 0 ? Math.ceil(itemPosition / limit) : 1;
      const totalItems = positionResult.__total_items;
      const totalPages = Math.ceil(totalItems / limit);

      const fetchedPages = getFetchedPages(pageNumber, totalPages);
      const mergedFetchedData = extractFetchedPageData(
        allData,
        fetchedPages,
        limit,
      );
      const pagedData = splitDataByPages(allData, fetchedPages, limit);
      const itemIndex = calculateItemIndex(
        Number(itemPosition),
        fetchedPages,
        limit,
      );

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(mergedFetchedData),
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD CONTAINER',
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
        itemIndex: itemIndex.zeroBasedIndex,
        fetchedPages,
        pagedData,
      };
    } catch (error) {
      throw new Error(`Error creating parameter: ${error.message}`);
    }
  }

  async findAll(
    {
      search,
      filters = {},
      pagination = {},
      sort,
      isLookUp,
      flag,
    }: FindAllParams,
    trx: any,
  ) {
    try {
      const { page = 1, limit = 0 } = pagination;
      const excludedFields = [
        'created_at',
        'updated_at',
        'modifiedby',
        'type_nama',
        'statusaktif_nama',
        'cabang_nama',
        'parent_nama',
        'memo',
        'info',
      ];

      // Helper untuk sorting
      const getSortColumn = (sortBy?: string) => {
        if (!sortBy) return 'u.id';

        const sortMapping = {
          type_nama: 't.nama',
          statusaktif_nama: 'p.text',
          cabang_nama: 'c.nama',
        };

        return sortMapping[sortBy] || `u.${sortBy}`;
      };

      // Cek apakah perlu join untuk filter atau sort
      const needsCabangJoin =
        filters.cabang_nama || sort?.sortBy === 'cabang_nama';
      const needsTypeJoin = filters.type_nama || sort?.sortBy === 'type_nama';
      const needsParamJoin =
        filters.statusaktif_nama || sort?.sortBy === 'statusaktif_nama';

      // Helper untuk apply filters
      const applyFilters = (query: any, includeJoins = true) => {
        // Base filters pada table utama (FILTER DULU SEBELUM JOIN)
        if (search) {
          const sanitizedValue = String(search).replace(/\[/g, '[[]');
          query.where((builder) => {
            builder
              .orWhere('u.coa', 'like', `${sanitizedValue}%`)
              .orWhere('u.keterangancoa', 'like', `%${sanitizedValue}%`);
          });
        }

        // Apply filters pada kolom utama SEBELUM join
        Object.entries(filters).forEach(([key, value]) => {
          if (excludedFields.includes(key) || !value) return;

          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          // Filter yang bisa langsung di table utama
          if (!['type_nama', 'statusaktif_nama', 'cabang_nama'].includes(key)) {
            if (key === 'created_at' || key === 'updated_at') {
              query.whereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else {
              query.where(`u.${key}`, 'like', `${sanitizedValue}%`);
            }
          }
        });

        // JOIN hanya jika diperlukan
        if (includeJoins) {
          if (needsCabangJoin) {
            query.leftJoin('cabang as c', 'u.cabang_id', 'c.id');
            if (filters.cabang_nama) {
              query.where(
                'c.nama',
                'like',
                `${String(filters.cabang_nama).replace(/\[/g, '[[]')}%`,
              );
            }
          }

          if (needsTypeJoin) {
            query.leftJoin('typeakuntansi as t', 'u.type_id', 't.id');
            if (filters.type_nama) {
              query.where(
                't.nama',
                'like',
                `${String(filters.type_nama).replace(/\[/g, '[[]')}%`,
              );
            }
          }

          if (needsParamJoin) {
            query.leftJoin('parameter as p', 'u.statusaktif', 'p.id');
            if (filters.statusaktif_nama) {
              query.where(
                'p.text',
                'like',
                `${String(filters.statusaktif_nama).replace(/\[/g, '[[]')}%`,
              );
            }
          }
        }

        return query;
      };

      // Lookup optimization - gunakan NOT EXISTS
      let lookupCondition: ((query: any) => void) | null = null;
      if (isLookUp) {
        // Quick count check
        const quickCount = await trx(this.tableName)
          .count('id as total')
          .first();

        if (Number(quickCount?.total || 0) > 500) {
          return { data: { type: 'json' } };
        }

        // Gunakan NOT EXISTS
        lookupCondition = (query) => {
          query.whereNotExists(function () {
            this.select(trx.raw('1'))
              .from(`${trx.raw('??', [this.tableName])} as parent`)
              .whereRaw('parent.parent = u.coa');
          });
        };
      }

      // ===== COUNT QUERY - OPTIMIZED =====
      let countQuery = trx(`${this.tableName} as u`);
      countQuery = applyFilters(countQuery, true);

      if (lookupCondition) {
        countQuery.where(lookupCondition);
      }

      const countResult = await countQuery.count('u.id as total').first();
      const total = Number(countResult?.total || 0);

      // Early return jika tidak ada data
      if (total === 0) {
        return {
          data: [],
          total: 0,
          pagination: {
            currentPage: Number(page),
            totalPages: 0,
            totalItems: 0,
            itemsPerPage: limit > 0 ? limit : 0,
          },
        };
      }

      // ===== DATA QUERY - OPTIMIZED dengan CTE =====
      const orderByClause = getSortColumn(sort?.sortBy);
      const orderDirection = sort?.sortDirection?.toUpperCase() || 'ASC';

      // Build filtered IDs query
      let filteredIdsQuery = trx(`${this.tableName} as u`).select('u.id');

      filteredIdsQuery = applyFilters(filteredIdsQuery, true);

      if (lookupCondition) {
        filteredIdsQuery.where(lookupCondition);
      }

      // Apply sorting ke filtered query
      filteredIdsQuery.orderBy(trx.raw(orderByClause), orderDirection);

      // Apply pagination
      if (limit > 0) {
        const offset = (page - 1) * limit;
        filteredIdsQuery.offset(offset).limit(limit);
      }

      // Get the IDs first
      const filteredIds = await filteredIdsQuery;
      const ids = filteredIds.map((row) => row.id);

      // Early return jika tidak ada hasil setelah filter
      if (ids.length === 0) {
        return {
          data: [],
          total,
          pagination: {
            currentPage: Number(page),
            totalPages: Math.ceil(total / (limit || 1)),
            totalItems: total,
            itemsPerPage: limit > 0 ? limit : total,
          },
        };
      }

      // Main query dengan ROW_NUMBER untuk nomor urut
      const dataQuery = trx(`${this.tableName} as u`)
        .select([
          trx.raw(
            `ROW_NUMBER() OVER (ORDER BY ${orderByClause} ${orderDirection}) + ? as nomor`,
            [limit > 0 ? (page - 1) * limit : 0],
          ),
          'u.id',
          'u.type_id',
          'u.level',
          'u.coa',
          'u.keterangancoa',
          'u.statusaktif',
          'p.text as statusaktif_nama',
          'p.memo',
          'u.parent',
          'u.cabang_id',
          'c.nama as cabang_nama',
          't.nama as type_nama',
          'u.info',
          'u.modifiedby',
          'u.created_at',
          'u.updated_at',
        ])
        .whereIn('u.id', ids)
        .leftJoin('cabang as c', 'u.cabang_id', 'c.id')
        .leftJoin('typeakuntansi as t', 'u.type_id', 't.id')
        .leftJoin('parameter as p', 'u.statusaktif', 'p.id')
        .orderBy(trx.raw(orderByClause), orderDirection);

      const data = await dataQuery;
      const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

      const result = {
        data,
        total,
        pagination: {
          currentPage: Number(page),
          totalPages,
          totalItems: total,
          itemsPerPage: limit > 0 ? limit : total,
        },
      };

      if (flag === 'GET POSITION') {
        return {
          query: dataQuery.toQuery(),
          ...result,
        };
      }

      return result;
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }
  async update(data: any, trx: any) {
    try {
      const existingData = await trx(this.tableName)
        .where('id', data.id)
        .first();

      if (!existingData) {
        throw new Error('Container not found');
      }

      const {
        sortBy,
        sortDirection,
        filters,
        search,
        id,
        page,
        limit,
        statusaktif_nama,
        cabang_nama,
        type_nama,
        ...insertData
      } = data;

      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['coa', 'keterangancoa', 'parent'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });
      const hasChanges = this.utilsService.hasChanges(insertData, existingData);

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(insertData);
      }

      const { data: allData } = await this.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false, // Set based on your requirement (e.g., lookup flag)
        },
        trx,
      );

      // If there is no data, skip creating the temp table and return minimal result
      if (!allData || allData.length === 0) {
        // Cache empty result
        await this.redisService.set(
          `${this.tableName}-allItems`,
          JSON.stringify([]),
        );

        // Log the edit action
        await this.logTrailService.create(
          {
            namatabel: this.tableName,
            postingdari: 'EDIT CONTAINER',
            idtrans: id,
            nobuktitrans: id,
            aksi: 'EDIT',
            datajson: JSON.stringify(data),
            modifiedby: data.modifiedby,
          },
          trx,
        );

        return {
          itemIndex: 0,
          fetchedPages: [],
          pagedData: {},
        };
      }

      const { tempTableName } = await this.utilsService.createTempTableFromData(
        allData,
        trx,
        this.tableName,
      );
      // Get position from temporary table (ini adalah posisi global dari SEMUA data, 1-based)
      const positionResult = await trx(tempTableName)
        .select('position', '__total_items')
        .where('id', id)
        .first();

      // Posisi global
      const itemPosition = positionResult?.position ?? 0;

      // Hitung page berdasarkan limit
      const pageNumber = limit > 0 ? Math.ceil(itemPosition / limit) : 1;
      const totalItems = positionResult.__total_items;
      const totalPages = Math.ceil(totalItems / limit);

      const fetchedPages = getFetchedPages(pageNumber, totalPages);
      const mergedFetchedData = extractFetchedPageData(
        allData,
        fetchedPages,
        limit,
      );
      const pagedData = splitDataByPages(allData, fetchedPages, limit);
      const itemIndex = calculateItemIndex(
        Number(itemPosition),
        fetchedPages,
        limit,
      );

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(mergedFetchedData),
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT CONTAINER',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      return {
        itemIndex: itemIndex.zeroBasedIndex,
        fetchedPages,
        pagedData,
      };
    } catch (error) {
      console.error('Error updating container:', error);
      throw new Error('Failed to update container');
    }
  }

  async delete(id: number, trx: any, modifiedby: string) {
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
          postingdari: 'DELETE CONTAINER',
          idtrans: deletedData.id,
          nobuktitrans: deletedData.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
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
  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');
    worksheet.mergeCells('A1:H1');
    worksheet.mergeCells('A2:H2');
    worksheet.mergeCells('A3:H3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN AKUN PUSAT';
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

    // Mendefinisikan header kolom
    const headers = [
      'NO.',
      'TYPE AKUNTANSI',
      'COA',
      'PARENT',
      'LEVEL',
      'KETERANGAN COA',
      'CABANG',
      'STATUS AKTIF',
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
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
      };

      // if (index === 2) {
      //   cell.alignment = { horizontal: 'right', vertical: 'middle' };
      //   cell.numFmt = '0'; // angka polos tanpa ribuan / desimal
      // } else {
      //   cell.alignment = {
      //     horizontal: index === 0 ? 'right' : 'left',
      //     vertical: 'middle',
      //   };
      // }

      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    data.forEach((row, rowIndex) => {
      const currentRow = rowIndex + 6;
      const rowValues = [
        rowIndex + 1,
        row.type_nama,
        row.coa,
        row.parent,
        row.level,
        row.keterangancoa,
        row.cabang_nama,
        row.statusaktif_nama,
      ];

      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);

        if (colIndex === 4) {
          cell.value = Number(value);
          cell.numFmt = '0'; // format angka dengan ribuan
          cell.alignment = {
            horizontal: 'right',
            vertical: 'middle',
          };
        } else {
          cell.value = value ?? '';
          cell.alignment = {
            horizontal: colIndex === 0 ? 'right' : 'left',
            vertical: 'middle',
          };
        }

        // cell.value = value ?? '';
        cell.font = { name: 'Tahoma', size: 10 };
        // cell.alignment = {
        //   horizontal: colIndex === 0 ? 'right' : 'left',
        //   vertical: 'middle',
        // };
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
      `laporan_akun_pusat_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
