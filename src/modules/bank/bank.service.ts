import {
  Inject,
  Injectable,
  InternalServerErrorException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import {
  withUuidV7,
  formatDateToSQL,
  UtilsService,
  getFetchedPages,
  calculateItemIndex,
  toNumeric,
  uuidV7,
} from 'src/utils/utils.service';
import { RedisService } from 'src/common/redis/redis.service';
import { ExportSheetDefinition } from 'src/common/report/export-job.service';
import * as fs from 'fs';
import * as path from 'path';
import { Workbook, Column } from 'exceljs';
import { EXCEL_FORMAT } from 'src/common/report/export-job.service';
import { Knex } from 'knex';

@Injectable()
export class BankService {
  private readonly logger = new Logger(BankService.name);
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  private readonly tableName = 'bank';
  private readonly viewName = 'vbank';

  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    const excludeSearchKeys = ['statusaktif', 'text', 'memo', 'icon',
        'statusbank',
        'statusaktif',
        'statusdefault',
        'formatpenerimaan',
        'formatpengeluaran',
        'formatpenerimaangantung',
        'formatpengeluarangantung',
        'formatpencairan',
        'formatrekappenerimaan',
        'formatrekappengeluaran',
        'coa',
        'coagantung',
    ];

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
              "TO_CHAR(vb.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?",
              [field, `%${sanitizedValue}%`],
            );
          } else {
            query.orWhereRaw(`CAST(vb.?? AS TEXT) ILIKE ?`, [
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
        qb.andWhereRaw("TO_CHAR(vb.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else if (key === 'text' || key === 'memo') {
        qb.andWhere(`vb.statusaktif_${key}`, '=', sanitizedValue);
      } else {
        qb.andWhere(`vb.${key}`, 'ilike', `%${sanitizedValue}%`);
      }
    });
  }

  private buildInsertData(dto: any, uuid?: string): Record<string, any> {
    return {
      id: uuid ? uuid : dto.uuid,
      nama: dto.nama ? dto.nama.toUpperCase() : null,
      keterangan: dto.keterangan ? dto.keterangan.toUpperCase() : null,
      coa: dto.coa,
      coagantung: dto.coagantung,
      statusbank: dto.statusbank,
      statusaktif: dto.statusaktif,
      statusdefault: dto.statusdefault,
      formatpenerimaan: dto.formatpenerimaan,
      formatpengeluaran: dto.formatpengeluaran,
      formatpenerimaangantung: dto.formatpenerimaangantung,
      formatpengeluarangantung: dto.formatpengeluarangantung,
      formatpencairan: dto.formatpencairan,
      formatrekappenerimaan: dto.formatrekappenerimaan,
      formatrekappengeluaran: dto.formatrekappengeluaran,
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
        return { col: 'text', dir: 'asc' }; // findAll: hardcode 'asc' on vb.nama
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

  async create(CreateBankDto: any, trx: any) {
    try {
      const { sortBy, sortDirection, filters, search, page, limit, info } =
        CreateBankDto;

      const uuid = await uuidV7(trx);
      const insertData = this.buildInsertData(CreateBankDto, uuid);
      await trx(this.tableName).insert(insertData);
      const newItem = await trx(this.viewName).where('id', uuid).first();

      const existingData = await trx(`${this.viewName} as vb`)
        .where('id', newItem.id)
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();

      // 3. Hitung posisi & total dengan filter yang sama
      let posisi: number;
      let totalItems: number;

      // totalItems selalu dihitung dengan filter — fix bug utama
      const totalRecords = await trx(`${this.viewName} as vb`)
        .count('id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      totalItems = Number(totalRecords?.total ?? 0);

      if (existingData) {
        const { col: posCol, dir: posDir } = this.resolvePositionOrder(
          sortBy,
          sortDirection,
        );
        const resultposition = await trx(`${this.viewName} as vb`)
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
          postingdari: 'ADD BANK',
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
      throw new Error(`Error creating bank: ${error.message}`);
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
  
        const countResult = await trx(`${this.viewName} as vb`)
          .count('vb.id as total')
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
  
        // SELECT disesuaikan DENGAN SCHEMA BANK yang sebenarnya
        const query = trx(`${this.viewName} as vb`).select([
          'vb.id',
          'vb.nama',
          'vb.keterangan',
          'vb.coa',
          'vb.coagantung',
          'vb.keterangancoa',
          'vb.keterangancoagantung',
          'vb.statusbank',
          'vb.statusaktif',
          'vb.statusdefault',
          'vb.formatpenerimaan',
          'vb.formatpengeluaran',
          'vb.formatpenerimaangantung',
          'vb.formatpengeluarangantung',
          'vb.formatpencairan',
          'vb.formatrekappenerimaan',
          'vb.formatrekappengeluaran',
          'vb.info',
          'vb.modifiedby',
          trx.raw("TO_CHAR(vb.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(vb.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'vb.memo',
          'vb.text',
          'vb.statusbank_text',
          'vb.statusbank_memo',
          'vb.statusdefault_text',
          'vb.statusdefault_memo',
          'vb.formatpenerimaantext',
          'vb.formatpengeluarantext',
          'vb.formatpenerimaangantungtext',
          'vb.formatpengeluarangantungtext',
          'vb.formatpencairantext',
          'vb.formatrekappenerimaantext',
          'vb.formatrekappengeluarantext',
        ]);
  
        query.modify((qb) => this.applyFilters(qb, safeFilters, search));
  
        if (sortBy === 'statusaktif') {
          query.orderBy('vb.text', sortDirection);
        } else {
          query.orderBy(`vb.${sortBy}`, sortDirection);
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
        this.logger.error('Error fetching bank data', error?.stack);
        throw new InternalServerErrorException('Failed to fetch bank data');
      }
    }

  async update(id: string, data: any, trx: any) {
    try {
      const existedData = await trx(this.tableName).where('id', id).first();

      if (!existedData) {
        throw new NotFoundException('Bank tidak ditemukan');
      }

      const { sortBy, sortDirection, filters, search, limit } = data;
      const insertData = this.buildInsertData(data);
      delete insertData.id;
      delete insertData.created_at;

      Object.keys(insertData).forEach((key) => {
        if (typeof insertData[key] === 'string') {
          insertData[key] = insertData[key].toUpperCase();
        }
      });

      const hasChanges = this.utilsService.hasChanges(insertData, existedData);

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(insertData);
      }
      const updatedItem = await trx(this.viewName).where('id', id).first();

      const existingData = await trx(`${this.viewName} as vb`)
        .where('id', updatedItem.id)
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();

      // 3. Hitung posisi & total dengan filter yang sama
      let posisi: number;
      let totalItems: number;

      // totalItems selalu dihitung dengan filter — fix bug utama
      const totalRecords = await trx(`${this.viewName} as vb`)
        .count('id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      totalItems = Number(totalRecords?.total ?? 0);
      if (existingData) {
        const { col: posCol, dir: posDir } = this.resolvePositionOrder(
          sortBy,
          sortDirection,
        );
        const resultposition = await trx(`${this.viewName} as vb`)
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
          postingdari: 'EDIT BANK',
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
      console.error('Error updating Bank:', error);
      throw new Error('Failed to update Bank');
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
          postingdari: 'DELETE BANK',
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
    'vb.nama',
    'vb.keterangan',

    'vb.coa',
    'vb.coagantung',

    'vb.statusbank_text',
    'vb.text',
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

    const query = db(`${this.viewName} as vb`)
      .select(this.EXPORT_COLUMNS)
      .modify((qb: any) => this.applyFilters(qb, safeFilters, search));

    if (sortBy === 'statusaktif') {
      query.orderBy('vb.text', 'asc');
    } else if (sortBy === 'statusbank') {
      query.orderBy('vb.statusbank_text', sortDirection);
    } else if (sortBy === 'statusdefault') {
      query.orderBy('vb.statusdefault_text', sortDirection);
    } else if (sortBy === 'statuslangsungcair') {
      query.orderBy('vb.statuslangsungcair_text', sortDirection);
    } else {
      query.orderBy(`vb.${sortBy}`, sortDirection);
    }

    return query;
  }

  async countExportRows(
    { search, filters }: Pick<FindAllParams, 'search' | 'filters'>,
    db: any,
  ): Promise<number> {
    const result = await db(`${this.tableName} as vb`)
      .count('vb.id as total')
      .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
      .first();

    return Number(result?.total ?? 0);
  }

  readonly exportSheet = {
    sheetName: 'Data Export',
    titleLines: [
      'PT. TRANSPORINDO AGUNG SEJAHTERA',
      'LAPORAN BANK',
      'Data Export',
    ],
    headers: [
      'NO.',
      'NAMA',
      'KETERANGAN',
      'COA',
      'COA GANTUNG',
      'STATUS BANK',
      'STATUS AKTIF',
    ],
    columnWidths: [
      5, 25, 50, 10, 15, 15, 15
    ],
    columnFormats: [
      null, // NO. — default sudah rata kanan
      null, // NAMA
      { wrapText: true }, // KETERANGAN — teks panjang dibungkus
      null, // COA
      null, // COA GANTUNG
      { align: 'center' as const }, // STATUS BANK ... — teks ditengah
      { align: 'center' as const }, // STATUS AKTIF ... — teks ditengah
    ],
    mapRow: (row: any, rowNumber: number) => [
      rowNumber,
      row.nama,
      row.keterangan,

      row.coa,
      row.gantung,

      row.statusbank_text,
      row.text,
    ],
  };

  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:G1');
    worksheet.mergeCells('A2:G2');
    worksheet.mergeCells('A3:G3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN BANK';
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
      'NAMA',
      'KETERANGAN',
      'COA',
      'COA GANTUNG',
      'STATUS BANK',
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
        horizontal: index === 0 ? 'right' : 'center', // header NO. -> kanan
        vertical: 'middle',
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    worksheet.getRow(5).height = 18;

    data.forEach((row, rowIndex) => {
      const currentRow = rowIndex + 6;

      worksheet.getCell(currentRow, 1).value = rowIndex + 1;
      worksheet.getCell(currentRow, 2).value = row.nama;
      worksheet.getCell(currentRow, 3).value = row.keterangan;
      worksheet.getCell(currentRow, 4).value = row.keterangancoa;
      worksheet.getCell(currentRow, 5).value = row.keterangancoagantung;
      worksheet.getCell(currentRow, 6).value = row.statusbank_text;
      worksheet.getCell(currentRow, 7).value = row.text;

      // Styling untuk setiap cell
      for (let col = 1; col <= headers.length; col++) {
        const cell = worksheet.getCell(currentRow, col);
        cell.font = { name: 'Tahoma', size: 10 };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
        cell.alignment = {
          horizontal: col === 1 ? 'right' : 'left', // NO. rata kanan
          vertical: 'middle',
        };
      }
    });

    worksheet.getColumn(1).width = 6; // NO
    worksheet.getColumn(2).width = 20; // NAMA
    worksheet.getColumn(3).width = 30; // KETERANGAN
    worksheet.getColumn(4).width = 25; // KETERANGAN COA
    worksheet.getColumn(5).width = 25; // KETERANGAN COA GANTUNG
    worksheet.getColumn(6).width = 20; // STATUS BANK
    worksheet.getColumn(7).width = 15; // STATUS AKTIF

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_bank_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}