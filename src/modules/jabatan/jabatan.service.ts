import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { CreateJabatanDto } from './dto/create-jabatan.dto';
import { UpdateJabatanDto } from './dto/update-jabatan.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { RedisService } from 'src/common/redis/redis.service';
import {
  calculateItemIndex,
  getFetchedPages,
  UtilsService,
  uuidV7,
} from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import * as fs from 'fs';
import * as path from 'path';
import { Workbook, Column } from 'exceljs';
import { Knex } from 'knex';
import { EXCEL_FORMAT } from 'src/common/report/export-job.service';

@Injectable()
export class JabatanService {
  private readonly logger = new Logger(JabatanService.name);
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
  ) {}
  private readonly tableName = 'jabatan';
  private readonly viewName = 'vjabatan';

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
            // pakai query, bukan qb — statement yang ditambahkan ke qb saat
            // callback grup dievaluasi tidak ikut ter-compile (hilang diam-diam)
            query.orWhereRaw("to_char(u.??, 'DD-MM-YYYY HH24:MI:SS') ilike ?", [
              field,
              `%${sanitizedValue}%`,
            ]);
          } else {
            query.orWhere(`u.${field}`, 'ilike', `%${sanitizedValue}%`);
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
        qb.andWhereRaw("to_char(u.??, 'DD-MM-YYYY HH24:MI:SS') ilike ?", [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else {
        // ✅ prefix u. agar konsisten dengan alias view
        qb.andWhere(`u.${key}`, 'ilike', `%${sanitizedValue}%`);
      }
    });
  }

  private buildInsertData(dto: any, uuid?: string): Record<string, any> {
    return {
      id: uuid ? uuid : dto.uuid, // id (uuidV7)
      nama: dto.nama ? dto.nama.toUpperCase() : null,
      keterangan: dto.keterangan ? dto.keterangan.toUpperCase() : null,
      statusaktif: dto.statusaktif,
      divisi_id: dto.divisi_id,
      info: dto.info ?? null,
      modifiedby: dto.modifiedby,
      created_at: dto.created_at || this.utilsService.getTime(),
      updated_at: dto.updated_at || this.utilsService.getTime(),
    };
  }

  private resolvePositionOrder(
    sortBy: string,
    sortDirection: string,
  ): { col: string; dir: 'asc' | 'desc' } {
    const dir = sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
    switch (sortBy) {
      case 'statusaktif':
        return { col: 'statusaktif_text', dir };
      default:
        return { col: sortBy, dir };
    }
  }

  async create(CreateJabatanDto: any, trx: any) {
    try {
      const { sortBy, sortDirection, filters, search, page, limit, info } =
        CreateJabatanDto;

      const uuid = await uuidV7(trx);
      const insertData = this.buildInsertData(CreateJabatanDto, uuid);
      await trx(this.tableName).insert(insertData);
      const newItem = await trx(this.viewName).where('id', uuid).first();

      const existingData = await trx(`${this.viewName} as u`)
        .where('id', newItem.id)
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();

      // 3. Hitung posisi & total dengan filter yang sama
      let posisi: number;
      let totalItems: number;

      // totalItems selalu dihitung dengan filter — fix bug utama
      const totalRecords = await trx(`${this.viewName} as u`)
        .count('id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      totalItems = Number(totalRecords?.total ?? 0);

      if (existingData) {
        const { col: posCol, dir: posDir } = this.resolvePositionOrder(
          sortBy,
          sortDirection,
        );
        const resultposition = await trx(`${this.viewName} as u`)
          .count('* as posisi')
          .where(posCol, posDir === 'desc' ? '>=' : '<=', existingData[posCol])
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
          sort: { sortBy, sortDirection: sortDirection.toLowerCase() },
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
          postingdari: 'ADD JABATAN',
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
      throw new Error(`Error creating jabatan: ${error.message}`);
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
    trx: Knex.Transaction,
  ) {
    try {
      const { page = 1, limit = 0, customOffset } = pagination ?? {};

      const sortBy = sort?.sortBy || 'nama';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'asc' ? 'asc' : 'desc';
      const safeFilters = filters || {};
      const countResult = await trx(`${this.viewName} as u`)
        .count('u.id as total')
        .modify((qb) => this.applyFilters(qb, safeFilters, search))
        .first();
      const total = Number(countResult?.total ?? 0);
      if (isLookUp && total > 500) {
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

      // Data dari view (mengandung _text, _memo, dll)
      const query = trx(`${this.viewName} as u`).select([
        'u.id',
        'u.nama',
        'u.keterangan',
        'u.statusaktif',
        'u.statusaktif_text',
        'u.statusaktif_memo',
        'u.divisi_id',
        'u.divisi_id_text',
        'u.info',
        'u.modifiedby',
        trx.raw("to_char(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
        trx.raw("to_char(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
      ]);

      query.modify((qb) => this.applyFilters(qb, safeFilters, search));

      if (sortBy === 'statusaktif') {
        query.orderBy('u.statusaktif_text', sortDirection);
      } else {
        query.orderBy(`u.${sortBy}`, sortDirection);
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
      this.logger.error('Error fetching jabatan data', error?.stack);
      throw new InternalServerErrorException('Failed to fetch jabatan data');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      const existedData = await trx(this.tableName).where('id', id).first();

      if (!existedData) {
        throw new Error('Jabatan not found');
      }

      // Cek unik di DALAM transaksi (lihat NOTE di update-jabatan.dto.ts).
      const duplicateNama = await trx(this.tableName)
        .whereRaw('lower(trim(??)) = lower(trim(?))', ['nama', data.nama])
        .whereNot('id', id)
        .first();
      if (duplicateNama) {
        throw new BadRequestException([
          { path: ['nama'], message: 'Jabatan dengan nama ini sudah ada' },
        ]);
      }

      const { sortBy, sortDirection, filters, search, limit } = data;
      const insertData = this.buildInsertData(data);
      delete insertData.id;
      delete insertData.created_at;

      const hasChanges = this.utilsService.hasChanges(insertData, existedData);

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(insertData);
      }

      // Ambil baris yang SUDAH diperbarui dari view — sama persis seperti create
      // mengambil `newItem` by uuid. View memuat kolom turunan (_text/_memo)
      // yang tidak ada di tabel base; dipakai untuk acuan posisi dan
      // sebagai data balikan agar polanya konsisten dengan ADD. Query tanpa
      // filter supaya baris selalu ketemu walau hasil edit tak lagi cocok
      // dengan filter aktif.
      const updatedItem = await trx(this.viewName).where('id', id).first();

      const existingData = await trx(`${this.viewName} as u`)
        .where('id', updatedItem.id)
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();

      // 3. Hitung posisi & total dengan filter yang sama
      let posisi: number;
      let totalItems: number;

      // totalItems selalu dihitung dengan filter — fix bug utama
      const totalRecords = await trx(`${this.viewName} as u`)
        .count('id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      totalItems = Number(totalRecords?.total ?? 0);
      if (existingData) {
        // Sama seperti create: hitung posisi memakai kolom & arah yang sama
        // dengan urutan tampil grid (kolom teks untuk status), bukan id UUID.
        const { col: posCol, dir: posDir } = this.resolvePositionOrder(
          sortBy,
          sortDirection,
        );
        const resultposition = await trx(`${this.viewName} as u`)
          .count('* as posisi')
          .where(posCol, posDir === 'desc' ? '>=' : '<=', existingData[posCol])
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
          sort: { sortBy, sortDirection: sortDirection.toLowerCase() },
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
          postingdari: 'EDIT JABATAN',
          idtrans: updatedItem.id,
          nobuktitrans: updatedItem.id,
          aksi: 'EDIT',
          datajson: JSON.stringify(updatedItem),
          modifiedby: updatedItem.modifiedby,
        },
        trx,
      );

      await this.redisService.set(
        `${this.tableName}-page-${pageNumber}`,
        JSON.stringify(allFetchedData),
      );
      return {
        updatedItem,
        itemIndex: itemIndex.zeroBasedIndex < 0 ? 0 : itemIndex.zeroBasedIndex,
        pageNumber,
        fetchedPages,
        pagedData,
      };
    } catch (error) {
      console.error('Error updating Jabatan:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new Error('Failed to update Jabatan');
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
          postingdari: 'DELETE JABATAN',
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

  /** Kolom yang benar-benar dipakai file export — bukan seluruh kolom view. */
  private readonly EXPORT_COLUMNS = [
    'u.nama',
    'u.keterangan',
    'u.statusaktif_text',
    'u.divisi_id_text',
  ];

  /**
   * Query dasar export: filter & sort yang sama dengan findAll, TANPA paging
   * dan hanya kolom yang dipakai file Excel.
   *
   * Dipisah supaya export bisa di-stream lewat cursor (`.stream()`) — menarik
   * jutaan baris view lengkap ke sebuah array lebih dulu adalah yang membuat
   * proses kehabisan heap.
   */
  buildExportQuery(
    {
      search,
      filters,
      sort,
    }: Pick<FindAllParams, 'search' | 'filters' | 'sort'>,
    db: any,
  ) {
    const safeFilters = filters || {};
    const sortBy = sort?.sortBy || 'nama';
    const sortDirection =
      sort?.sortDirection?.toLowerCase() === 'asc' ? 'asc' : 'desc';

    const query = db(`${this.viewName} as u`)
      .select(this.EXPORT_COLUMNS)
      .modify((qb: any) => this.applyFilters(qb, safeFilters, search));

    if (sortBy === 'statusaktif') {
      query.orderBy('u.statusaktif_text', sortDirection);
    } else {
      query.orderBy(`u.${sortBy}`, sortDirection);
    }

    return query;
  }

  /**
   * Jumlah baris yang akan diekspor. Dihitung dari VIEW karena filter grid
   * memakai kolom teks lookup (`*_text`) yang tidak ada di tabel base.
   * Dipakai untuk progres export yang sebenarnya.
   */
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

  /**
   * Data LaporanJabatan.mrt: baris yang lolos filter & sort grid. Memakai
   * query export karena kolom yang dibaca template sama dengan EXPORT_COLUMNS.
   */
  async loadReportData(
    params: Pick<FindAllParams, 'search' | 'filters' | 'sort'>,
    { username, judullaporan }: { username: string; judullaporan?: string },
    db: any,
  ) {
    const rows = await this.buildExportQuery(params, db);

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const tglcetak =
      `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ` +
      `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    return rows.map((row: any) => ({
      ...row,
      judullaporan: judullaporan ?? 'Laporan Jabatan',
      usercetak: username,
      tglcetak,
      judul: 'PT.TRANSPORINDO AGUNG SEJAHTERA',
    }));
  }

  /** Definisi sheet export — dipakai jalur background (streaming). */
  readonly exportSheet = {
    sheetName: 'Data Export',
    titleLines: [
      'PT. TRANSPORINDO AGUNG SEJAHTERA',
      'LAPORAN JABATAN',
      'Data Export',
    ],
    headers: ['NO.', 'NAMA', 'KETERANGAN', 'STATUS AKTIF', 'DIVISI'],
    columnWidths: [5, 30, 25, 20, 20],

    // Mode streaming tidak bisa auto-fit, jadi lebarnya ditetapkan di sini.
    mapRow: (row: any, rowNumber: number) => [
      rowNumber,
      row.nama,
      row.keterangan,
      row.statusaktif_text,
      row.divisi_id_text,
    ],
  };

  /**
   * Merakit workbook Excel dan mengembalikannya sebagai buffer.
   *
   * Hanya untuk export kecil (endpoint GET /jabatan/export yang lama):
   * seluruh data ditampung di memori. Export lewat background job memakai
   * ExportJobService yang streaming.
   */
  async buildExcelBuffer(data: any[]): Promise<Buffer> {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:E1');
    worksheet.mergeCells('A2:E2');
    worksheet.mergeCells('A3:E3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN JABATAN';
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

    const headers = ['NO.', 'NAMA', 'KETERANGAN', 'STATUS AKTIF', 'DIVISI'];

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
        horizontal: index === 0 ? 'right' : 'center',
        vertical: 'middle',
      };
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
        row.nama,
        row.keterangan,
        row.statusaktif_text,
        row.divisi_id_text,
      ];
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

    const adjustCols: number[] = [4];
    adjustCols.forEach((colIndex) => {
      const col = worksheet.getColumn(colIndex);
      const currentWidth = col.width ?? 20;
      col.width = Math.max(10, currentWidth / 2);
    });

    worksheet.getColumn(1).width = 6;

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async exportToExcel(data: any[]) {
    const buffer = await this.buildExcelBuffer(data);

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_jabatan_${Date.now()}.xlsx`,
    );
    await fs.promises.writeFile(tempFilePath, buffer);

    return tempFilePath;
  }
}
