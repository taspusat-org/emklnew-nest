import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { RedisService } from 'src/common/redis/redis.service';
import {
  calculateItemIndex,
  getFetchedPages,
  UtilsService,
  uuidV7,
} from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { dbMssql } from 'src/common/utils/db';
import * as fs from 'fs';
import * as path from 'path';
import { Workbook, Column } from 'exceljs';
import { Knex } from 'knex';

@Injectable()
export class CabangService {
  private readonly logger = new Logger(CabangService.name);
  // Nama tabel — dipakai untuk query SQL, redis key & logtrail namatabel.
  // Frontend membaca redis `cabang-page-<n>`, jadi JANGAN diubah.
  private readonly tableName = 'cabang';
  constructor(
    // Inject wrapper RedisService (BUKAN raw 'REDIS_CLIENT') — best-effort cache,
    // tidak menggagalkan create/update saat Redis mati.
    private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}

  // Deteksi pelanggaran FOREIGN KEY MSSQL (error 547). cabang.statusaktif punya
  // FK ke parameter, dan tabel transaksi (karyawan dll) punya FK ke cabang.id.
  private isForeignKeyError(error: any): boolean {
    return (
      // Postgres: pelanggaran FK = SQLSTATE 23503
      error?.code === '23503' ||
      // MSSQL lama: error number 547
      error?.number === 547 ||
      error?.originalError?.info?.number === 547 ||
      /foreign key constraint|REFERENCE constraint|conflicted with the .*constraint/i.test(
        error?.message ?? '',
      )
    );
  }

  // JOIN ke `parameter` (`par`) untuk teks/memo status aktif. namacabang_hr
  // ditambahkan sebagai raw subquery di select masing-masing query.
  // Postgres tidak punya table hint → dihapus.
  private baseQuery(trx: any) {
    return trx
      .from(`${this.tableName} as jo`)
      .leftJoin('parameter as par', 'jo.statusaktif', 'par.id');
  }

  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    const excludeSearchKeys: string[] = [];

    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );
    const dateFields = ['created_at', 'updated_at'];

    if (search && filters && Object.keys(filters).length > 0) {
      const sanitizedValue = String(search).trim();
      qb.where((query) => {
        searchFields.forEach((field) => {
          if (dateFields.includes(field)) {
            query.orWhereRaw(
              "TO_CHAR(jo.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?",
              [field, `%${sanitizedValue}%`],
            );
          } else if (field === 'statusaktif') {
            query.orWhere('par.text', 'ilike', `%${sanitizedValue}%`);
          } else {
            query.orWhere(`jo.${field}`, 'ilike', `%${sanitizedValue}%`);
          }
        });
      });
    }

    Object.entries(filters || {}).forEach(([key, rawValue]) => {
      if (excludeSearchKeys.includes(key)) return;
      if (rawValue === null || rawValue === undefined || rawValue === '')
        return;

      const sanitizedValue = String(rawValue);
      if (dateFields.includes(key)) {
        qb.andWhereRaw("TO_CHAR(jo.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else if (key === 'statusaktif') {
        qb.andWhere('jo.statusaktif', sanitizedValue);
      } else {
        qb.andWhere(`jo.${key}`, 'ilike', `%${sanitizedValue}%`);
      }
    });
  }

  private buildInsertData(dto: any, uuid?: string): Record<string, any> {
    return {
      id: uuid ? uuid : dto.id,
      kodecabang: dto.kodecabang ? dto.kodecabang.toUpperCase() : null,
      nama: dto.nama ? dto.nama.toUpperCase() : null,
      keterangan: dto.keterangan ? dto.keterangan.toUpperCase() : null,
      statusaktif: dto.statusaktif,
      modifiedby: dto.modifiedby,
      created_at: dto.created_at || this.utilsService.getTime(),
      updated_at: dto.updated_at || this.utilsService.getTime(),
    };
  }

  private resolvePositionOrder(
    sortBy: string,
    sortDirection: string,
  ): { col: string; valueKey: string; dir: 'asc' | 'desc' } {
    const dir = sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
    switch (sortBy) {
      case 'statusaktif':
        return { col: 'par.text', valueKey: 'statusaktif_text', dir: 'asc' };
      default:
        return { col: `jo.${sortBy}`, valueKey: sortBy, dir };
    }
  }

  private selectColumns(trx: any) {
    return [
      'jo.id as id',
      'jo.kodecabang',
      'jo.nama',
      'jo.keterangan',
      'jo.statusaktif',
      'jo.modifiedby',
      trx.raw("TO_CHAR(jo.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
      trx.raw("TO_CHAR(jo.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
      'par.memo as memo',
      'par.text as text',
      'par.text as statusaktif_text',
    ];
  }

  async create(createCabangDto: any, trx: any) {
    try {
      const {
        sortBy = 'nama',
        sortDirection = 'asc',
        filters,
        search,
        page,
        limit,
      } = createCabangDto;

      const uuid = await uuidV7(trx);

      const insertData = this.buildInsertData(createCabangDto, uuid);
      await trx(this.tableName).insert(insertData);

      const newItem = await this.baseQuery(trx)
        .select(this.selectColumns(trx))
        .where('jo.id', uuid)
        .first();

      const existingData = await this.baseQuery(trx)
        .select('jo.*', 'par.text as statusaktif_text')
        .where('jo.id', uuid)
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();

      let posisi: number;
      let totalItems: number;

      const totalRecords = await this.baseQuery(trx)
        .count('jo.id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      totalItems = Number(totalRecords?.total ?? 0);

      if (existingData) {
        const { col, valueKey, dir } = this.resolvePositionOrder(
          sortBy,
          sortDirection,
        );
        const resultposition = await this.baseQuery(trx)
          .count('* as posisi')
          .where((qb) => {
            // MSSQL `ORDER BY col ASC` menaruh baris ber-NULL paling ATAS.
            // Kalau baris NULL tidak ikut dihitung, posisi baris baru jadi
            // kurang sebanyak jumlah baris NULL → fokus grid meleset naik
            // (mis. data cabang punya nama NULL). Sertakan baris NULL saat asc;
            // saat desc, NULL ada di bawah jadi tidak dihitung.
            if (dir === 'desc') {
              qb.where(col, '>=', existingData[valueKey]);
            } else {
              qb.where(col, '<=', existingData[valueKey]).orWhereNull(col);
            }
          })
          .modify((qb) => this.applyFilters(qb, filters, search))
          .first();

        posisi = Number(resultposition?.posisi ?? 0);
      } else {
        posisi = 1;
      }

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
          sort: {
            sortBy,
            sortDirection: String(sortDirection).toLowerCase() as 'asc' | 'desc',
          },
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

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD CABANG',
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      await this.redisService.set(
        `${this.tableName}-page-${pageNumber}`,
        JSON.stringify(allFetchedData),
      );

      return {
        newItem,
        itemIndex: itemIndex.zeroBasedIndex,
        pageNumber,
        fetchedPages,
        pagedData,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (this.isForeignKeyError(error)) {
        throw new ConflictException('Status Aktif yang dipilih tidak valid.');
      }
      throw new Error(`Error creating cabang: ${error.message}`);
    }
  }

  async findAll(
    { search, filters, pagination, sort, useCustomOffset }: FindAllParams,
    trx: Knex.Transaction,
  ) {
    try {
      const { page = 1, limit = 0, customOffset } = pagination ?? {};

      const sortBy = sort?.sortBy || 'nama';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
      const safeFilters = filters || {};

      const countResult = await this.baseQuery(trx)
        .count('jo.id as total')
        .modify((qb) => this.applyFilters(qb, safeFilters, search))
        .first();
      const total = Number(countResult?.total ?? 0);

      const query = this.baseQuery(trx).select(this.selectColumns(trx));

      query.modify((qb) => this.applyFilters(qb, safeFilters, search));

      if (sortBy === 'statusaktif') {
        query.orderBy('par.text', 'asc');
      } else {
        query.orderBy(`jo.${sortBy}`, sortDirection);
      }

      const offset =
        useCustomOffset === true && customOffset !== undefined
          ? customOffset
          : (page - 1) * limit;

      if (limit > 0) {
        query.offset(offset).limit(limit);
      }

      const data = await query;
      const totalPages = Math.ceil(total / limit);
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
      this.logger.error('Error fetching cabang data', error?.stack);
      throw new InternalServerErrorException('Failed to fetch cabang data');
    }
  }

  async checkRole(id: string) {
    try {
      const cabangUsage = await dbMssql('karyawan')
        .where({ cabang_id: id })
        .select('cabang_id');

      return cabangUsage.length > 0;
    } catch (error) {
      console.error('Error in processCheckCabang:', error);
      throw new Error('Failed to check cabang usage');
    }
  }

  async findAllByIds(ids: { id: string }[]) {
    try {
      const idList = ids.map((item) => item.id);

      if (idList.length === 0) {
        return [];
      }

      // Postgres: cukup pakai whereIn, tak perlu temp table.
      const data = await dbMssql(`${this.tableName} as c`)
        .select([
          'c.id',
          'c.kodecabang',
          'c.nama as namacabang',
          'c.keterangan',
          'c.statusaktif',
          'p.memo',
          'p.text',
          'c.modifiedby',
          dbMssql.raw(
            "TO_CHAR(c.created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at",
          ),
          dbMssql.raw(
            "TO_CHAR(c.updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at",
          ),
        ])
        .leftJoin('parameter as p', 'c.statusaktif', 'p.id')
        .whereIn('c.id', idList)
        .orderBy('c.nama', 'ASC');

      return data;
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async getById(id: string, trx: any) {
    try {
      const result = await trx(this.tableName).where('id', id).first();

      if (!result) {
        throw new Error('Data not found');
      }

      return result;
    } catch (error) {
      console.error('Error fetching data by id:', error);
      throw new Error('Failed to fetch data by id');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      const existedData = await trx(this.tableName).where('id', id).first();

      if (!existedData) {
        throw new Error('Cabang not found');
      }

      const {
        sortBy = 'nama',
        sortDirection = 'asc',
        filters,
        search,
        limit,
      } = data;

      const insertData: Record<string, any> = {
        kodecabang: data.kodecabang ? data.kodecabang.toUpperCase() : null,
        nama: data.nama ? data.nama.toUpperCase() : null,
        keterangan: data.keterangan ? data.keterangan.toUpperCase() : null,
        statusaktif: data.statusaktif,
        modifiedby: data.modifiedby,
      };

      const hasChanges = this.utilsService.hasChanges(insertData, existedData);

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(insertData);
      }

      const existingData = await this.baseQuery(trx)
        .select('jo.*', 'par.text as statusaktif_text')
        .where('jo.id', id)
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();

      let posisi: number;
      let totalItems: number;

      const totalRecords = await this.baseQuery(trx)
        .count('jo.id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      totalItems = Number(totalRecords?.total ?? 0);

      if (existingData) {
        const { col, valueKey, dir } = this.resolvePositionOrder(
          sortBy,
          sortDirection,
        );
        const resultposition = await this.baseQuery(trx)
          .count('* as posisi')
          .where((qb) => {
            // MSSQL `ORDER BY col ASC` menaruh baris ber-NULL paling ATAS.
            // Kalau baris NULL tidak ikut dihitung, posisi baris baru jadi
            // kurang sebanyak jumlah baris NULL → fokus grid meleset naik
            // (mis. data cabang punya nama NULL). Sertakan baris NULL saat asc;
            // saat desc, NULL ada di bawah jadi tidak dihitung.
            if (dir === 'desc') {
              qb.where(col, '>=', existingData[valueKey]);
            } else {
              qb.where(col, '<=', existingData[valueKey]).orWhereNull(col);
            }
          })
          .modify((qb) => this.applyFilters(qb, filters, search))
          .first();

        posisi = Number(resultposition?.posisi ?? 0);
      } else {
        posisi = 1;
      }

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
          sort: {
            sortBy,
            sortDirection: String(sortDirection).toLowerCase() as 'asc' | 'desc',
          },
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
      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT CABANG',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      await this.redisService.set(
        `${this.tableName}-page-${pageNumber}`,
        JSON.stringify(allFetchedData),
      );
      return {
        updatedItem: {
          id,
          ...data,
        },
        itemIndex: itemIndex.zeroBasedIndex < 0 ? 0 : itemIndex.zeroBasedIndex,
        pageNumber,
        fetchedPages,
        pagedData,
      };
    } catch (error) {
      console.error('Error updating cabang:', error);
      if (error instanceof HttpException) throw error;
      if (this.isForeignKeyError(error)) {
        throw new ConflictException('Status Aktif yang dipilih tidak valid.');
      }
      throw new Error('Failed to update cabang');
    }
  }

  async remove(id: string, trx: any, modifiedby: string) {
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
          postingdari: 'DELETE CABANG',
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
      if (this.isForeignKeyError(error)) {
        throw new ConflictException(
          'Cabang tidak dapat dihapus karena sudah digunakan pada transaksi lain.',
        );
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
    worksheet.getCell('A2').value = 'LAPORAN CABANG';
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

    const headers = [
      'No.',
      'KODE CABANG',
      'NAMA CABANG',
      'KETERANGAN',
      'STATUS AKTIF',
      'MODIFIED BY',
      'CREATED AT',
      'UPDATED AT',
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

    data.forEach((row, rowIndex) => {
      worksheet.getCell(rowIndex + 6, 1).value = rowIndex + 1;
      worksheet.getCell(rowIndex + 6, 2).value = row.kodecabang;
      worksheet.getCell(rowIndex + 6, 3).value = row.namacabang ?? row.nama;
      worksheet.getCell(rowIndex + 6, 4).value = row.keterangan;
      worksheet.getCell(rowIndex + 6, 5).value = row.text;
      worksheet.getCell(rowIndex + 6, 6).value = row.modifiedby;
      worksheet.getCell(rowIndex + 6, 7).value = row.created_at;
      worksheet.getCell(rowIndex + 6, 8).value = row.updated_at;

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

    worksheet.getColumn(1).width = 10;
    worksheet.getColumn(2).width = 20;
    worksheet.getColumn(3).width = 30;
    worksheet.getColumn(4).width = 45;
    worksheet.getColumn(5).width = 40;
    worksheet.getColumn(6).width = 20;
    worksheet.getColumn(7).width = 40;
    worksheet.getColumn(8).width = 40;

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_cabang${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
