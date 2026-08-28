import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { CreateAsuransiDto } from './dto/create-asuransi.dto';
import { UpdateAsuransiDto } from './dto/update-asuransi.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { RedisService } from 'src/common/redis/redis.service';
import {
  calculateItemIndex,
  getFetchedPages,
  toNumeric,
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

const MONEY_COLUMNS = [
  'ratemodal',
  'ratejual',
  'nominalasuransi',
  'rateopendoor',
  'adminbiaya',
  'admintagih',
  'batas1',
  'batas2',
  'batas3',
  'materai1',
  'materai2',
  'materai3',
];

@Injectable()
export class AsuransiService {
  private readonly logger = new Logger(AsuransiService.name);
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
  ) {}
  private readonly tableName = 'asuransi';
  private readonly viewName = 'vasuransi';

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
          if (['created_at', 'updated_at'].includes(field)) {
            qb.orWhereRaw("to_char(va.??, 'DD-MM-YYYY HH24:MI:SS') ilike ?", [
              field,
              `%${sanitizedValue}%`,
            ]);
          } else {
            query.orWhereRaw('va.??::text ilike ?', [
              field,
              `%${sanitizedValue}%`,
            ]);
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
        qb.andWhereRaw("to_char(va.??, 'DD-MM-YYYY HH24:MI:SS') ilike ?", [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else {
        qb.andWhereRaw('va.??::text ilike ?', [key, `%${sanitizedValue}%`]);
      }
    });
  }

  private buildInsertData(dto: any, uuid?: string): Record<string, any> {
    return {
      id: uuid ? uuid : dto.uuid,
      nama: dto.nama ? dto.nama.toUpperCase() : null,
      keterangan: dto.keterangan ? dto.keterangan.toUpperCase() : null, // Wajib isi
      contactperson: dto.contactperson ? dto.contactperson.toUpperCase() : null, // Wajib isi
      alamat: dto.alamat ? dto.alamat.toUpperCase() : null,
      kota: dto.kota ? dto.kota.toUpperCase() : null,
      kodepos: dto.kodepos ? dto.kodepos.toUpperCase() : null,
      telp: dto.telp ? dto.telp.toUpperCase() : null,
      email: dto.email ? dto.email.toUpperCase() : null,
      fax: dto.fax ? dto.fax.toUpperCase() : null,
      web: dto.web ? dto.web.toUpperCase() : null,
      ratemodal: toNumeric(dto.ratemodal) ?? 0,
      ratejual: toNumeric(dto.ratejual) ?? 0,
      npwp: dto.npwp ? dto.npwp.toUpperCase() : null,
      nominalasuransi: toNumeric(dto.nominalasuransi) ?? 0,
      rateopendoor: toNumeric(dto.rateopendoor) ?? 0,
      adminbiaya: toNumeric(dto.adminbiaya) ?? 0,
      admintagih: toNumeric(dto.admintagih) ?? 0,
      batas1: toNumeric(dto.batas1) ?? 0,
      batas2: toNumeric(dto.batas2) ?? 0,
      batas3: toNumeric(dto.batas3) ?? 0,
      materai1: toNumeric(dto.materai1) ?? 0,
      materai2: toNumeric(dto.materai2) ?? 0,
      materai3: toNumeric(dto.materai3) ?? 0,
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
        return { col: 'text', dir: 'asc' }; // findAll: hardcode 'asc' on va.nama
      case 'statusbank':
        return { col: 'statusbank_nama', dir };
      case 'statusdefault':
        return { col: 'statusdefault_nama', dir };
      case 'statuslangsungcair':
        return { col: 'statuslangsungcair_nama', dir };
      default:
        return { col: sortBy, dir };
    }
  }

  async create(CreateAsuransiDto: any, trx: any) {
    try {
      const { sortBy, sortDirection, filters, search, page, limit, info } =
        CreateAsuransiDto;

      const uuid = await uuidV7(trx);

      const insertData = this.buildInsertData(CreateAsuransiDto, uuid);
      await trx(this.tableName).insert(insertData);
      const newItem = await trx(this.viewName).where('id', uuid).first();

      const existingData = await trx(`${this.viewName} as va`)
        .where('id', newItem.id)
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();

      // 3. Hitung posisi & total dengan filter yang sama
      let posisi: number;
      let totalItems: number;

      // totalItems selalu dihitung dengan filter — fix bug utama
      const totalRecords = await trx(`${this.viewName} as va`)
        .count('id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      totalItems = Number(totalRecords?.total ?? 0);

      if (existingData) {
        const { col: posCol, dir: posDir } = this.resolvePositionOrder(
          sortBy,
          sortDirection,
        );
        const resultposition = await trx(`${this.viewName} as va`)
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
          postingdari: 'ADD ASURANSI',
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
      throw new Error(`Error creating asuransi: ${error.message}`);
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

      const countResult = await trx(`${this.tableName} as va`)
        .count('va.id as total')
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

      // SELECT disesuaikan DENGAN SCHEMA ASURANSI yang sebenarnya
      const query = trx(`${this.viewName} as va`).select([
        'va.id',
        'va.nama',
        'va.keterangan',
        'va.contactperson',
        'va.alamat',
        'va.kota',
        'va.kodepos',
        'va.telp',
        'va.email',
        'va.fax',
        'va.web',
        'va.ratemodal',
        'va.ratejual',
        'va.npwp',
        'va.nominalasuransi',
        'va.rateopendoor',
        'va.adminbiaya',
        'va.admintagih',
        'va.batas1',
        'va.batas2',
        'va.batas3',
        'va.materai1',
        'va.materai2',
        'va.materai3',
        'va.statusaktif',
        'va.text',
        'va.memo',
        'va.info',
        'va.modifiedby',
        trx.raw(
          "to_char(va.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
        ),
        trx.raw(
          "to_char(va.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
        ),
      ]);

      query.modify((qb) => this.applyFilters(qb, safeFilters, search));

      if (sortBy === 'statusaktif') {
        query.orderBy('va.text', sortDirection);
      } else {
        query.orderBy(`va.${sortBy}`, sortDirection);
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
      this.logger.error('Error fetching asuransi data', error?.stack);
      throw new InternalServerErrorException('Failed to fetch asuransi data');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      const existedData = await trx(this.tableName).where('id', id).first();

      if (!existedData) {
        throw new Error('Asuransi not found');
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

      const existingData = await trx(`${this.viewName} as va`)
        .where('id', updatedItem.id)
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();

      // 3. Hitung posisi & total dengan filter yang sama
      let posisi: number;
      let totalItems: number;

      // totalItems selalu dihitung dengan filter — fix bug utama
      const totalRecords = await trx(`${this.viewName} as va`)
        .count('id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      totalItems = Number(totalRecords?.total ?? 0);
      if (existingData) {
        const { col: posCol, dir: posDir } = this.resolvePositionOrder(
          sortBy,
          sortDirection,
        );
        const resultposition = await trx(`${this.viewName} as va`)
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
          postingdari: 'EDIT ASURANSI',
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
      console.error('Error updating Asuransi:', error);
      throw new Error('Failed to update Asuransi');
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
          postingdari: 'DELETE ASURANSI',
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
    'va.nama',
    'va.keterangan',
    'va.contactperson',
    'va.alamat',
    'va.kota',
    'va.kodepos',
    'va.telp',
    'va.email',
    'va.fax',
    'va.web',
    'va.ratemodal',
    'va.ratejual',
    'va.npwp',
    'va.nominalasuransi',
    'va.rateopendoor',
    'va.adminbiaya',
    'va.batas1',
    'va.batas2',
    'va.batas3',
    'va.materai1',
    'va.materai2',
    'va.materai3',
    'va.text',
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

    const query = db(`${this.viewName} as va`)
      .select(this.EXPORT_COLUMNS)
      .modify((qb: any) => this.applyFilters(qb, safeFilters, search));

    if (sortBy === 'statusaktif') {
      query.orderBy('va.text', 'asc');
    } else if (sortBy === 'statusbank') {
      query.orderBy('va.statusbank_text', sortDirection);
    } else if (sortBy === 'statusdefault') {
      query.orderBy('va.statusdefault_text', sortDirection);
    } else if (sortBy === 'statuslangsungcair') {
      query.orderBy('va.statuslangsungcair_text', sortDirection);
    } else {
      query.orderBy(`va.${sortBy}`, sortDirection);
    }

    return query;
  }

  async countExportRows(
    { search, filters }: Pick<FindAllParams, 'search' | 'filters'>,
    db: any,
  ): Promise<number> {
    const result = await db(`${this.tableName} as va`)
      .count('va.id as total')
      .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
      .first();

    return Number(result?.total ?? 0);
  }

  readonly exportSheet = {
    sheetName: 'Data Export',
    titleLines: [
      'PT. TRANSPORINDO AGUNG SEJAHTERA',
      'LAPORAN ASURANSI',
      'Data Export',
    ],
    headers: [
      'NO.',
      'NAMA',
      'KETERANGAN',
      'CONTACT PERSON',
      'ALAMAT',
      'KOTA',
      'KODE POS',
      'NO TELP',
      'EMAIL',
      'FAX',
      'WEB',
      'RATE MODAL',
      'RATE JUAL',
      'NPWP',
      'NOMINAL ASURANSI',
      'RATE OPEN DOOR',
      'ADMIN BIAYA',
      'BATAS 1',
      'BATAS 2',
      'BATAS 3',
      'MATERAI 1',
      'MATERAI 2',
      'MATERAI 3',
      'STATUS AKTIF',
    ],
    columnWidths: [
      5, 25, 50, 17, 30, 20, 10, 12, 25, 15, 25, 15, 15, 15, 15, 15, 15, 15, 15,
      15, 15, 15, 15, 15,
    ],
    columnFormats: [
      null, // NO. — default sudah rata kanan
      null, // NAMA
      { wrapText: true }, // KETERANGAN — teks panjang dibungkus
      null, // CONTACT PERSON
      null, // ALAMAT
      null, // KOTA
      null, // KODE POS
      null, // NO TELP
      null, // EMAIL
      null, // FAX
      null, // WEB
      { numFmt: EXCEL_FORMAT.RUPIAH }, // RATE MODAL
      { numFmt: EXCEL_FORMAT.RUPIAH }, // RATE JUAL
      null, // NPWP
      { numFmt: EXCEL_FORMAT.RUPIAH }, // NOMINAL ASURANSI
      { numFmt: EXCEL_FORMAT.RUPIAH }, // RATE OPEN DOOR
      { numFmt: EXCEL_FORMAT.RUPIAH }, // ADMIN BIAYA
      { numFmt: EXCEL_FORMAT.RUPIAH }, // BATAS 1
      { numFmt: EXCEL_FORMAT.RUPIAH }, // BATAS 2
      { numFmt: EXCEL_FORMAT.RUPIAH }, // BATAS 3
      { numFmt: EXCEL_FORMAT.RUPIAH }, // MATERAI 1
      { numFmt: EXCEL_FORMAT.RUPIAH }, // MATERAI 2
      { numFmt: EXCEL_FORMAT.RUPIAH }, // MATERAI 3
      { align: 'center' as const }, // STATUS AKTIF ... — teks ditengah
    ],
    mapRow: (row: any, rowNumber: number) => [
      rowNumber,
      row.nama,
      row.keterangan,
      row.contactperson,
      row.alamat,

      row.kota,
      row.kodepos,
      row.telp,
      row.email,
      row.fax,

      row.web,
      row.ratemodal,
      row.ratejual,
      row.npwp,
      row.nominalasuransi,

      row.rateopendoor,
      row.adminbiaya,
      row.batas1,
      row.batas2,
      row.batas3,

      row.materai1,
      row.materai2,
      row.materai3,
      row.text,
    ],
  };

  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:X1');
    worksheet.mergeCells('A2:X2');
    worksheet.mergeCells('A3:X3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN ASURANSI';
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
      'CONTACT PERSON',
      'ALAMAT',
      'KOTA',
      'KODE POS',
      'NO TELP',
      'EMAIL',
      'FAX',
      'WEB',
      'RATE MODAL',
      'RATE JUAL',
      'NPWP',
      'NOMINAL ASURANSI',
      'RATE OPEN DOOR',
      'ADMIN BIAYA',
      'BATAS 1',
      'BATAS 2',
      'BATAS 3',
      'MATERAI 1',
      'MATERAI 2',
      'MATERAI 3',
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
        row.contactperson,
        row.alamat,
        row.kota,
        row.kodepos,
        row.telp,
        row.email,
        row.fax,
        row.web,
        row.ratemodal,
        row.ratejual,
        row.npwp,
        row.nominalasuransi,
        row.rateopendoor,
        row.adminbiaya,
        row.batas1,
        row.batas2,
        row.batas3,
        row.materai1,
        row.materai2,
        row.materai3,
        row.text,
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

    const adjustCols = [11];
    adjustCols.forEach((colIndex) => {
      const col = worksheet.getColumn(colIndex);
      const currentWidth = col.width ?? 20;
      col.width = Math.max(10, currentWidth / 2);
    });

    worksheet.getColumn(1).width = 6;

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_asuransi_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
