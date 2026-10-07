import {
  Inject,
  Injectable,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import {
  withUuidV7,
  UtilsService,
  toNumeric,
  calculateItemIndex,
  getFetchedPages,
  uuidV7,
} from 'src/utils/utils.service';
import { RedisService } from 'src/common/redis/redis.service';
import * as fs from 'fs';
import * as path from 'path';
import { Workbook, Column } from 'exceljs';
import { EXCEL_FORMAT } from 'src/common/report/export-job.service';

const MONEY_COLUMNS = ['nominal'];

@Injectable()
export class HargatruckingService {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  private readonly tableName = 'hargatrucking';
  private readonly viewName = 'vhargatrucking';

  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    const excludeSearchKeys = ['statusaktif', 'text', 'memo', 'icon'];

    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );
    const dateFields = ['created_at', 'updated_at'];

    if (search && searchFields.length > 0) {
      const sanitizedValue = String(search).trim();
      qb.where((query) => {
        searchFields.forEach((field) => {
          if (dateFields.includes(field)) {
            query.orWhereRaw(
              "TO_CHAR(vht.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?",
              [field, `%${sanitizedValue}%`],
            );
          } else {
            query.orWhereRaw(`CAST(vht.?? AS TEXT) ILIKE ?`, [
              field,
              `%${sanitizedValue}%`,
            ]);
          }
        });
      });
    }

    Object.entries(filters || {}).forEach(([key, rawValue]) => {
      if (rawValue === null || rawValue === undefined || rawValue === '')
        return;

      const sanitizedValue = String(rawValue);
      if (dateFields.includes(key)) {
        qb.andWhereRaw("TO_CHAR(vht.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else if (key === 'text' || key === 'memo') {
        qb.andWhere(`vht.statusaktif_${key}`, '=', sanitizedValue);
      } else {
        qb.andWhere(`vht.${key}`, 'ilike', `%${sanitizedValue}%`);
      }
    });
  }

  private buildInsertData(dto: any, uuid?: string): Record<string, any> {
    return {
      id: uuid ? uuid : dto.uuid,
      tujuankapal_id: dto.tujuankapal_id
        ? dto.tujuankapal_id.toUpperCase()
        : null,
      container_id: dto.container_id ? dto.container_id.toUpperCase() : null, // Wajib isi
      keterangan: dto.keterangan ? dto.keterangan.toUpperCase() : null,
      jenisorder_id: dto.jenisorder_id ? dto.jenisorder_id.toUpperCase() : null, // Wajib isi
      emkl_id: dto.emkl_id ? dto.emkl_id.toUpperCase() : null, // Wajib isi
      nominal: toNumeric(dto.nominal) ?? 0,
      statusaktif: dto.statusaktif,
      info: dto.info ? dto.info.toUpperCase() : null,
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
        return { col: 'text', dir: 'asc' }; // findAll: hardcode 'asc' on vht.nama
      case 'statusbank':
        return { col: 'statusbank_text', dir };
      case 'statusdefault':
        return { col: 'statusdefault_text', dir };
      case 'statuslangsungcair':
        return { col: 'statuslangsungcair_text', dir };
      default:
        return { col: sortBy, dir };
    }
  }

  async create(CreateaHargatruckingDto: any, trx: any) {
    try {
      const { sortBy, sortDirection, filters, search, page, limit, info } =
        CreateaHargatruckingDto;
      const uuid = await uuidV7(trx);
      const insertData = this.buildInsertData(CreateaHargatruckingDto, uuid);
      const x = await trx(this.tableName).insert(insertData);

      const newItem = await trx(this.viewName).where('id', uuid).first();
      const existingData = await trx(`${this.viewName} as vht`)
        .where('id', newItem.id)
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();

      // 3. Hitung posisi & total dengan filter yang sama
      let posisi: number;
      let totalItems: number;

      const totalRecords = await trx(`${this.viewName} as vht`)
        .count('id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      totalItems = Number(totalRecords?.total ?? 0);

      if (existingData) {
        const { col: posCol, dir: posDir } = this.resolvePositionOrder(
          sortBy,
          sortDirection,
        );

        const resultposition = await trx(`${this.viewName} as vht`)
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
          postingdari: 'ADD HARGA TRUCKING',
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
      throw new Error(`Error creating harga trucking: ${error.message}`);
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
      const { page = 1, limit = 0, customOffset } = pagination ?? {};

      const sortBy = sort?.sortBy || 'tujuankapal_text';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'asc' ? 'asc' : 'desc';
      const safeFilters = filters || {};

      // Count dari tabel BASE (hargatrucking), bukan view vhargatrucking.
      const countResult = await trx(`${this.viewName} as vht`)
        .count('vht.id as total')
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

      const query = trx(`${this.viewName} as vht`).select([
        'vht.id',
        'vht.keterangan',
        'vht.tarifdetail_id',
        'vht.emkl_id',
        'vht.emkl_text',
        'vht.tujuankapal_id',
        'vht.tujuankapal_text',
        'vht.container_id',
        'vht.container_text',
        'vht.jenisorder_id',
        'vht.jenisorder_text',
        'vht.nominal',
        'vht.statusaktif',
        'vht.text',
        'vht.memo',
        'vht.info',
        'vht.modifiedby',
        trx.raw(
          "TO_CHAR(vht.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
        ),
        trx.raw(
          "TO_CHAR(vht.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
        ),
      ]);

      query.modify((qb) => this.applyFilters(qb, safeFilters, search));

      // Sorting disesuaikan (hanya statusaktif yang butuh special handling ke .text)
      if (sortBy === 'statusaktif') {
        query.orderBy('vht.text', sortDirection); // Diperbaiki: gunakan sortDirection, bukan hardcode 'asc'
      } else {
        query.orderBy(`vht.${sortBy}`, sortDirection);
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
      console.error('Error fetching harga trucking data:', error);
      throw new Error('Failed to fetch harga trucking data');
    }
  }

  async findOne(id: string, trx: any) {
    try {
      const query = trx(`${this.viewName} as vht`).select([
        'vht.id',
        'vht.keterangan',
        'vht.tarifdetail_id',
        'vht.emkl_id',
        'vht.emkl_text',
        'vht.tujuankapal_id',
        'vht.tujuankapal_text',
        'vht.container_id',
        'vht.container_text',
        'vht.jenisorder_id',
        'vht.jenisorder_text',
        'vht.nominal',
        'vht.statusaktif',
        'vht.text',
        'vht.memo',
        'vht.info',
        'vht.modifiedby',
        trx.raw(
          "TO_CHAR(vht.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
        ),
        trx.raw(
          "TO_CHAR(vht.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
        ),
      ]);

      query.where('id', id);

      const [data] = await query;
      return {
        data: data,
      };
    } catch (error) {
      console.error('Error fetching data findone biaya trucking by id:', error);
      throw new Error('Failed to fetch data findone biaya trucking by id');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      const existedData = await trx(this.tableName).where('id', id).first();

      if (!existedData) {
        throw new Error('harga trucking not found');
      }

      const { sortBy, sortDirection, filters, search, limit } = data;
      const insertData = this.buildInsertData(data);
      delete insertData.id;
      delete insertData.created_at;

      Object.keys(insertData).forEach((key) => {
        if (MONEY_COLUMNS.includes(key)) {
          insertData[key] = toNumeric(insertData[key]);
        } else if (typeof insertData[key] === 'string') {
          insertData[key] = insertData[key].toUpperCase();
        }
      });

      const hasChanges = this.utilsService.hasChanges(insertData, existedData);

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(insertData);
      }

      const updatedItem = await trx(this.viewName).where('id', id).first();

      const existingData = await trx(`${this.viewName} as vht`)
        .where('id', updatedItem.id)
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();

      // 3. Hitung posisi & total dengan filter yang sama
      let posisi: number;
      let totalItems: number;

      // totalItems selalu dihitung dengan filter — fix bug utama
      const totalRecords = await trx(`${this.viewName} as vht`)
        .count('id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      totalItems = Number(totalRecords?.total ?? 0);
      if (existingData) {
        const { col: posCol, dir: posDir } = this.resolvePositionOrder(
          sortBy,
          sortDirection,
        );
        const resultposition = await trx(`${this.viewName} as vht`)
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
          postingdari: 'EDIT HARGA TRUCKING',
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
      console.error('Error updating harga trucking:', error);
      throw new Error('Failed to update harga trucking');
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
          postingdari: 'DELETE HARGA TRUCKING',
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

  private readonly EXPORT_COLUMNS = [
    // 'vht.tarifdetail_id',
    'vht.tujuankapal_text',
    'vht.emkl_text',
    'vht.keterangan',
    'vht.container_text',
    'vht.jenisorder_text',
    'vht.nominal',
    'vht.text',
  ];

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

    const query = db(`${this.viewName} as vht`)
      .select(this.EXPORT_COLUMNS)
      .modify((qb: any) => this.applyFilters(qb, safeFilters, search));

    if (sortBy === 'statusaktif') {
      query.orderBy('vht.text', 'asc');
    } else if (sortBy === 'statusbank') {
      query.orderBy('vht.statusbank_text', sortDirection);
    } else if (sortBy === 'statusdefault') {
      query.orderBy('vht.statusdefault_text', sortDirection);
    } else if (sortBy === 'statuslangsungcair') {
      query.orderBy('vht.statuslangsungcair_text', sortDirection);
    } else {
      query.orderBy(`vht.${sortBy}`, sortDirection);
    }

    return query;
  }

  /**
   * Jumlah baris yang akan diekspor. Dihitung dari tabel BASE (bukan view):
   * LEFT JOIN di view tidak pernah menambah baris, jadi hasilnya sama tapi
   * tanpa overhead join. Dipakai untuk progres export yang sebenarnya.
   */
  async countExportRows(
    { search, filters }: Pick<FindAllParams, 'search' | 'filters'>,
    db: any,
  ): Promise<number> {
    const result = await db(`${this.viewName} as vht`)
      .count('vht.id as total')
      .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
      .first();

    return Number(result?.total ?? 0);
  }

  /** Definisi sheet export — dipakai jalur background (streaming). */
  readonly exportSheet = {
    sheetName: 'Data Export',
    titleLines: [
      'PT. TRANSPORINDO AGUNG SEJAHTERA',
      'LAPORAN HARGA TRUCKING',
      'Data Export',
    ],
    headers: [
      'NO.',
      'TUJUAN KAPAL',
      'EMKL',
      'KETERANGAN',
      'CONTAINER',
      'JENIS ORDERAN',
      'NOMINAL',
      'STATUS AKTIF',
    ],
    // Mode streaming tidak bisa auto-fit, jadi lebarnya ditetapkan di sini.
    columnWidths: [6, 20, 20, 50, 20, 20, 20, 15],
    columnFormats: [
      null, // NO. — default sudah rata kanan
      null, // TUJUAN KAPAL
      null, // EMKL
      { wrapText: true }, // KETERANGAN — teks panjang dibungkus
      null, // CONTAINER
      null, // JENIS ORDERAN
      { numFmt: EXCEL_FORMAT.RUPIAH }, // NOMINAL,
      { align: 'center' as const }, // STATUS AKTIF ... — teks ditengah
    ],
    mapRow: (row: any, rowNumber: number) => [
      rowNumber,
      row.tujuankapal_text,
      row.emkl_text,
      row.keterangan,
      row.container_text,
      row.jenisorder_text,
      row.nominal,
      row.text,
    ],
  };

  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:H1');
    worksheet.mergeCells('A2:H2');
    worksheet.mergeCells('A3:H3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN HARGA TRUCKING';
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
      'NO.',
      'TUJUAN KAPAL',
      'EMKL',
      'KETERANGAN',
      'CONTAINER',
      'JENIS ORDERAN',
      'NOMINAL',
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
      const rowValues = [
        rowIndex + 1,
        row.tujuankapal_text,
        row.emkl_text,
        row.keterangan,
        row.container_text,
        row.jenisorder_text,
        row.nominal,
        row.text,
      ];
      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);
        cell.value = value ?? '';
        cell.font = { name: 'Tahoma', size: 10 };

        if (colIndex === 6) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.numFmt = '#,##0'; // Format angka dengan pemisah ribuan
        } else {
          cell.alignment = {
            horizontal: colIndex === 0 ? 'right' : 'left',
            vertical: 'middle',
          };
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
    worksheet.getColumn(8).width = 20;
    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_hargatrucking_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
