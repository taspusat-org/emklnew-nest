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
export class DaftarblService {
  private readonly logger = new Logger(DaftarblService.name);
  // Nama tabel — dipakai untuk query SQL, redis key & logtrail namatabel.
  // Frontend membaca redis `daftarbl-page-<n>`, jadi JANGAN diubah.
  private readonly tableName = 'daftarbl';
  constructor(
    // Inject wrapper RedisService (BUKAN raw 'REDIS_CLIENT'). Wrapper membungkus
    // set/get/del dengan try/catch → cache bersifat best-effort: saat Redis mati,
    // create/update tetap sukses (lanjut tanpa cache) alih-alih gagal 500 "Stream
    // isn't writeable and enableOfflineQueue options is false". Raw client dengan
    // enableOfflineQueue:false akan langsung reject saat koneksi putus.
    private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}

  // Deteksi pelanggaran FOREIGN KEY MSSQL (error 547). daftarbl.statusaktif
  // punya FK ke parameter, dan tabel transaksi punya FK ke daftarbl.id.
  // Tanpa ini, FK violation jadi 500 generik tanpa pesan yang jelas.
  private isForeignKeyError(error: any): boolean {
    return (
      error?.number === 547 ||
      error?.originalError?.info?.number === 547 ||
      /REFERENCE constraint|conflicted with the .*constraint/i.test(
        error?.message ?? '',
      )
    );
  }

  // Data turunan (text/memo status aktif) diambil via JOIN ke `parameter` (`par`)
  // pada statusaktif. Builder ini dipakai bersama oleh findAll, count, dan
  // perhitungan posisi agar filter/sort konsisten.
  private baseQuery(trx: any) {
    return trx
      .from(trx.raw(`${this.tableName} as jo`))
      .leftJoin(
        trx.raw('parameter as par'),
        'jo.statusaktif',
        'par.id',
      );
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
      const sanitizedValue = String(search).replace(/\[/g, '[[]').trim();
      qb.where((query) => {
        searchFields.forEach((field) => {
          if (dateFields.includes(field)) {
            query.orWhereRaw("TO_CHAR(jo.??, 'DD-MM-YYYY HH24:MI:SS') like ?", [
              field,
              `%${sanitizedValue}%`,
            ]);
          } else if (field === 'statusaktif') {
            // Cari berdasarkan teks status aktif (par.text), bukan id UUID.
            query.orWhere('par.text', 'like', `%${sanitizedValue}%`);
          } else {
            query.orWhere(`jo.${field}`, 'like', `%${sanitizedValue}%`);
          }
        });
      });
    }

    Object.entries(filters || {}).forEach(([key, rawValue]) => {
      if (excludeSearchKeys.includes(key)) return;
      if (rawValue === null || rawValue === undefined || rawValue === '')
        return;

      const sanitizedValue = String(rawValue).replace(/\[/g, '[[]');
      if (dateFields.includes(key)) {
        qb.andWhereRaw("TO_CHAR(jo.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else if (key === 'statusaktif') {
        // Filter status aktif memakai id parameter (exact match).
        qb.andWhere('jo.statusaktif', sanitizedValue);
      } else {
        qb.andWhere(`jo.${key}`, 'like', `%${sanitizedValue}%`);
      }
    });
  }

  private buildInsertData(dto: any, uuid?: string): Record<string, any> {
    // Hanya nama & keterangan yang di-uppercase. statusaktif adalah id parameter
    // (varchar UUID) — JANGAN diubah-ubah casing-nya.
    return {
      id: uuid ? uuid : dto.id, // id (uuidV7)
      nama: dto.nama ? dto.nama.toUpperCase() : null,
      keterangan: dto.keterangan ? dto.keterangan.toUpperCase() : null,
      statusaktif: dto.statusaktif,
      modifiedby: dto.modifiedby,
      created_at: dto.created_at || this.utilsService.getTime(),
      updated_at: dto.updated_at || this.utilsService.getTime(),
    };
  }

  /**
   * Mengembalikan kolom + arah urut yang BENAR untuk menghitung posisi baris,
   * mereplikasi persis logika orderBy di findAll(). Untuk kolom status, grid
   * menampilkan urutan berdasarkan kolom TEKS (par.text), bukan id (varchar
   * UUID) — jadi posisi harus dihitung pakai kolom teks itu juga, kalau tidak
   * fokus baris setelah simpan akan meleset. `col` = ref SQL untuk WHERE/ORDER,
   * `valueKey` = nama field di baris hasil join untuk membaca nilainya.
   */
  private resolvePositionOrder(
    sortBy: string,
    sortDirection: string,
  ): { col: string; valueKey: string; dir: 'asc' | 'desc' } {
    const dir = sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
    switch (sortBy) {
      case 'statusaktif':
        // findAll: hardcode 'asc' pada par.text
        return { col: 'par.text', valueKey: 'statusaktif_text', dir: 'asc' };
      default:
        return { col: `jo.${sortBy}`, valueKey: sortBy, dir };
    }
  }

  async create(createDaftarblDto: any, trx: any) {
    try {
      const {
        sortBy = 'nama',
        sortDirection = 'asc',
        filters,
        search,
        page,
        limit,
      } = createDaftarblDto;

      const uuid = await uuidV7(trx);

      const insertData = this.buildInsertData(createDaftarblDto, uuid);
      await trx(this.tableName).insert(insertData);
      // id varchar UUID (bukan auto-increment) → orderBy('id','desc').first()
      // TIDAK mengembalikan baris baru. Ambil langsung by uuid yang baru
      // di-generate & insert.
      const newItem = await this.baseQuery(trx)
        .select(
          'jo.id as id',
          'jo.nama',
          'jo.keterangan',
          'jo.statusaktif',
          'jo.modifiedby',
          trx.raw("TO_CHAR(jo.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(jo.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'par.memo as memo',
          'par.text as text',
          'par.text as statusaktif_text',
        )
        .where('jo.id', uuid)
        .first();

      const existingData = await this.baseQuery(trx)
        .select('jo.*', 'par.text as statusaktif_text')
        .where('jo.id', uuid)
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();

      // 3. Hitung posisi & total dengan filter yang sama
      let posisi: number;
      let totalItems: number;

      // totalItems selalu dihitung dengan filter — fix bug utama
      const totalRecords = await this.baseQuery(trx)
        .count('jo.id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      totalItems = Number(totalRecords?.total ?? 0);

      if (existingData) {
        // Hitung posisi memakai kolom & arah yang SAMA dengan urutan tampil grid
        // (findAll). Untuk kolom status, bandingkan nilai TEKS dari baris hasil
        // join, bukan id UUID — supaya fokus baris setelah simpan tepat.
        const { col, valueKey, dir } = this.resolvePositionOrder(
          sortBy,
          sortDirection,
        );
        const resultposition = await this.baseQuery(trx)
          .count('* as posisi')
          .where((qb) => {
            // MSSQL ORDER BY ASC menaruh baris bernilai NULL paling ATAS, tetapi
            // `col <= value` TIDAK ikut menghitung baris NULL → posisi baris baru
            // undercount sebanyak jumlah baris NULL → pageNumber/itemIndex
            // meleset → baris baru jatuh di luar window yang dimuat → fokus
            // setelah simpan tidak mendarat di baris itu. Sertakan baris NULL
            // pada hitungan ascending. (DESC: NULL di paling bawah → cukup `>=`.)
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

      // 4. Pagination
      const pageNumber = Math.ceil(posisi / limit);
      const totalPages = Math.ceil(totalItems / limit);
      const fetchedPages = getFetchedPages(pageNumber, totalPages);

      const startPage = fetchedPages[0];
      const endPage = fetchedPages[fetchedPages.length - 1];
      const customOffset = (startPage - 1) * limit;
      const totalDataNeeded = (endPage - startPage + 1) * limit;

      // 5. Fetch sekali, split di memory
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

      // 6. Side-effects
      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD DAFTAR BL',
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
      throw new Error(`Error creating daftar bl: ${error.message}`);
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

      // Count dengan filter yang sama (fix: dulu count seluruh tabel tanpa
      // filter → totalPages salah saat filtering).
      const countResult = await this.baseQuery(trx)
        .count('jo.id as total')
        .modify((qb) => this.applyFilters(qb, safeFilters, search))
        .first();
      const total = Number(countResult?.total ?? 0);

      // Data + kolom turunan (text/memo status aktif)
      const query = this.baseQuery(trx).select([
        'jo.id as id',
        'jo.nama',
        'jo.keterangan',
        'jo.statusaktif',
        'jo.modifiedby',
        trx.raw("TO_CHAR(jo.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
        trx.raw("TO_CHAR(jo.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
        'par.memo as memo',
        'par.text as text',
        'par.text as statusaktif_text',
      ]);

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
      this.logger.error('Error fetching daftarbl data', error?.stack);
      throw new InternalServerErrorException('Failed to fetch daftarbl data');
    }
  }

  async findAllByIds(ids: { id: string }[]) {
    try {
      const idList = ids.map((item) => item.id);
      const tempData = `##temp_${Math.random().toString(36).substring(2, 15)}`;

      const createTempTableQuery = `
        CREATE TABLE ${tempData} (
          id NVARCHAR(100)
        );
      `;
      await dbMssql.raw(createTempTableQuery);

      const insertTempTableQuery = `
        INSERT INTO ${tempData} (id)
        VALUES ${idList.map((id) => `('${id}')`).join(', ')};
      `;
      await dbMssql.raw(insertTempTableQuery);

      const query = dbMssql(`${this.tableName} as jo`)
        .select([
          'jo.id as id',
          'jo.nama',
          'jo.keterangan',
          'jo.statusaktif',
          'jo.modifiedby',
          dbMssql.raw(
            "TO_CHAR(jo.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          dbMssql.raw(
            "TO_CHAR(jo.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
          'par.memo',
          'par.text',
        ])
        .leftJoin('parameter as par', 'jo.statusaktif', 'par.id')
        .join(dbMssql.raw(`${tempData} as temp`), 'jo.id', 'temp.id')
        .orderBy('jo.nama', 'ASC');

      const data = await query;

      const dropTempTableQuery = `DROP TABLE ${tempData};`;
      await dbMssql.raw(dropTempTableQuery);

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
        throw new Error('Daftar BL not found');
      }

      const {
        sortBy = 'nama',
        sortDirection = 'asc',
        filters,
        search,
        limit,
      } = data;

      // Bangun payload update — uppercase hanya nama & keterangan. JANGAN ikut
      // menulis created_at (akan reset tanggal dibuat setiap edit).
      const insertData: Record<string, any> = {
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

      // 3. Hitung posisi & total dengan filter yang sama
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
            // MSSQL ORDER BY ASC menaruh baris bernilai NULL paling ATAS, tetapi
            // `col <= value` TIDAK ikut menghitung baris NULL → posisi baris baru
            // undercount sebanyak jumlah baris NULL → pageNumber/itemIndex
            // meleset → baris baru jatuh di luar window yang dimuat → fokus
            // setelah simpan tidak mendarat di baris itu. Sertakan baris NULL
            // pada hitungan ascending. (DESC: NULL di paling bawah → cukup `>=`.)
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

      // 4. Pagination
      const pageNumber = Math.ceil(posisi / limit);
      const totalPages = Math.ceil(totalItems / limit);
      const fetchedPages = getFetchedPages(pageNumber, totalPages);

      const startPage = fetchedPages[0];
      const endPage = fetchedPages[fetchedPages.length - 1];
      const customOffset = (startPage - 1) * limit;
      const totalDataNeeded = (endPage - startPage + 1) * limit;

      // 5. Fetch sekali, split di memory
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
          postingdari: 'EDIT DAFTAR BL',
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
      console.error('Error updating daftar bl:', error);
      if (error instanceof HttpException) throw error;
      if (this.isForeignKeyError(error)) {
        throw new ConflictException('Status Aktif yang dipilih tidak valid.');
      }
      throw new Error('Failed to update daftar bl');
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
          postingdari: 'DELETE DAFTAR BL',
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
          'Daftar BL tidak dapat dihapus karena sudah digunakan pada transaksi lain.',
        );
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }

  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:D1');
    worksheet.mergeCells('A2:D2');
    worksheet.mergeCells('A3:D3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN DAFTAR BL';
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

    const headers = ['NO.', 'NAMA', 'KETERANGAN', 'STATUS AKTIF'];

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
      const rowValues = [rowIndex + 1, row.nama, row.keterangan, row.text];
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
      .forEach((col) => {
        let maxLength = 0;
        col.eachCell({ includeEmpty: true }, (cell) => {
          const cellValue = cell.value ? cell.value.toString() : '';
          maxLength = Math.max(maxLength, cellValue.length);
        });
        col.width = maxLength + 2;
      });

    worksheet.getColumn(1).width = 6;
    worksheet.getColumn(4).width = 20;

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_daftarbl_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
