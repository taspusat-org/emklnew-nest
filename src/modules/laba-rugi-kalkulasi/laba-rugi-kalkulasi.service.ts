import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Column, Workbook } from 'exceljs';
import { LocksService } from '../locks/locks.service';
import {
  withUuidV7,
  UtilsService,
  toNumeric,
  calculateItemIndex,
  getFetchedPages,
  uuidV7,
} from 'src/utils/utils.service';
import { GlobalService } from '../global/global.service';
import { RedisService } from 'src/common/redis/redis.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
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
export class LabaRugiKalkulasiService {
  private readonly tableName: string = 'labarugikalkulasi';
  private readonly viewName: string = 'vlabarugikalkulasi';

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
  ) {}

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
              "TO_CHAR(vlrk.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?",
              [field, `%${sanitizedValue}%`],
            );
          } else {
            query.orWhereRaw(`CAST(vlrk.?? AS TEXT) ILIKE ?`, [
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
        qb.andWhereRaw("TO_CHAR(vlrk.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else if (key === 'text' || key === 'memo') {
        qb.andWhere(`vlrk.statusaktif_${key}`, '=', sanitizedValue);
      } else {
        qb.andWhere(
          `CAST(vlrk.${key} AS TEXT)`,
          'ilike',
          `%${sanitizedValue}%`,
        );
      }
    });
  }

  private buildInsertData(dto: any, uuid?: string): Record<string, any> {
    return {
      id: uuid ? uuid : dto.uuid,
      periode: dto.periode,
      estkomisimarketing: toNumeric(dto.estkomisimarketing) ?? 0,
      estkomisimarketing2: toNumeric(dto.estkomisimarketing2) ?? 0,
      komisimarketing: toNumeric(dto.komisimarketing) ?? 0,
      biayakantorpusat: toNumeric(dto.biayakantorpusat) ?? 0,
      biayatour: toNumeric(dto.biayatour) ?? 0,
      gajidireksi: toNumeric(dto.gajidireksi) ?? 0,
      estkomisikacab: toNumeric(dto.estkomisikacab) ?? 0,
      biayabonustriwulan: toNumeric(dto.biayabonustriwulan) ?? 0,
      estkomisikacabcabang1: toNumeric(dto.estkomisikacabcabang1) ?? 0,
      estkomisikacabcabang2: toNumeric(dto.estkomisikacabcabang2) ?? 0,

      statusfinalkomisimarketing: dto.statusfinalkomisimarketing,
      statusfinalbonustriwulan: dto.statusfinalbonustriwulan,

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
        return { col: 'text', dir: 'asc' }; // findAll: hardcode 'asc' on vlrk.nama
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

  async create(CreateLabaRugiKalkulasiDto: any, trx: any) {
    try {
      const { sortBy, sortDirection, filters, search, page, limit, info } =
        CreateLabaRugiKalkulasiDto;

      const uuid = await uuidV7(trx);

      const insertData = this.buildInsertData(CreateLabaRugiKalkulasiDto, uuid);
      await trx(this.tableName).insert(insertData);
      const newItem = await trx(this.viewName).where('id', uuid).first();

      const existingData = await trx(`${this.viewName} as vlrk`)
        .where('id', newItem.id)
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();

      // 3. Hitung posisi & total dengan filter yang sama
      let posisi: number;
      let totalItems: number;

      // totalItems selalu dihitung dengan filter — fix bug utama
      const totalRecords = await trx(`${this.viewName} as vlrk`)
        .count('id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      totalItems = Number(totalRecords?.total ?? 0);

      if (existingData) {
        const { col: posCol, dir: posDir } = this.resolvePositionOrder(
          sortBy,
          sortDirection,
        );
        const resultposition = await trx(`${this.viewName} as vlrk`)
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
          postingdari: 'ADD LABA RUGI KALKULASI',
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
      throw new Error(`Error creating laba rugi kalkulasi: ${error.message}`);
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

      const sortBy = sort?.sortBy || 'periode';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'asc' ? 'asc' : 'desc';
      const safeFilters = filters || {};

      const countResult = await trx(`${this.viewName} as vlrk`)
        .count('vlrk.id as total')
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
      const query = trx(`${this.viewName} as vlrk`).select([
        'vlrk.id',
        'vlrk.periode',
        'vlrk.estkomisimarketing',
        'vlrk.estkomisimarketing2',

        'vlrk.komisimarketing',
        'vlrk.biayakantorpusat',
        'vlrk.biayatour',
        'vlrk.gajidireksi',
        'vlrk.estkomisikacab',
        'vlrk.biayabonustriwulan',

        'vlrk.estkomisikacabcabang1',
        'vlrk.estkomisikacabcabang2',

        'vlrk.statusfinalkomisimarketing',
        'vlrk.statusfinalkomisimarketing_text',
        'vlrk.statusfinalkomisimarketing_memo',

        'vlrk.statusfinalbonustriwulan',
        'vlrk.statusfinalbonustriwulan_text',
        'vlrk.statusfinalbonustriwulan_memo',

        'vlrk.info',
        'vlrk.modifiedby',
        trx.raw(
          "to_char(vlrk.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
        ),
        trx.raw(
          "to_char(vlrk.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
        ),
      ]);

      query.modify((qb) => this.applyFilters(qb, safeFilters, search));

      // Sorting disesuaikan (hanya statusaktif yang butuh special handling ke .text)
      if (sortBy === 'statusaktif') {
        query.orderBy('vlrk.text', sortDirection); // Diperbaiki: gunakan sortDirection, bukan hardcode 'asc'
      } else if (sortBy === 'periode') {
        query.orderByRaw(`to_date(vlrk.periode, 'MM-YYYY') ${sortDirection}`);
      } else {
        query.orderBy(`vlrk.${sortBy}`, sortDirection);
      }

      const offset =
        useCustomOffset === true && customOffset !== undefined
          ? customOffset
          : (page - 1) * limit;

      if (limit > 0) {
        query.offset(offset).limit(limit);
      }

      // console.log(query.toQuery());
      // Debug query dan nilainya sebelum dieksekusi:
      // console.log('Query:', query.toSQL().sql);
      // console.log('Bindings (Values):', query.toSQL().bindings);

      const data = await query;
      const totalPages = Math.ceil(total / limit);
      const responseType = total > 500 ? 'json' : 'local';
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
      console.error('Error to findAll Laba Rugi Kalkulasi', error);
      throw new Error(error);
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      const existedData = await trx(this.tableName).where('id', id).first();

      if (!existedData) {
        throw new Error('Laba Rugi Kalkulasi not found');
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

      const updatedItem = await trx(this.viewName).where('id', id).first();
      const existingData = await trx(`${this.viewName} as vlrk`)
        .where('id', updatedItem.id)
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();

      let posisi: number;
      let totalItems: number;

      const totalRecords = await trx(`${this.viewName} as vlrk`)
        .count('id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      totalItems = Number(totalRecords?.total ?? 0);
      if (existingData) {
        const { col: posCol, dir: posDir } = this.resolvePositionOrder(
          sortBy,
          sortDirection,
        );
        const resultposition = await trx(`${this.viewName} as vlrk`)
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
          postingdari: 'EDIT LABA RUGI KALKULASI',
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
      console.error('Error updating Laba Rugi Kalkulasi:', error);
      throw new Error('Failed to update Laba Rugi Kalkulasi');
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
          postingdari: 'DELETE LABA RUGI KALKULASI',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby,
        },
        trx,
      );

      return {
        status: 200,
        message: 'Data deleted successfully',
        deletedData,
      };
    } catch (error) {
      console.error('Error deleting data: ', error);
      if (error instanceof HttpException) {
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

  private readonly EXPORT_COLUMNS = [
    'vlrk.periode',
    'vlrk.estkomisimarketing',
    'vlrk.estkomisimarketing2',

    'vlrk.komisimarketing',
    'vlrk.biayakantorpusat',
    'vlrk.biayatour',
    'vlrk.gajidireksi',
    'vlrk.estkomisikacab',
    'vlrk.biayabonustriwulan',

    'vlrk.estkomisikacabcabang1',
    'vlrk.estkomisikacabcabang2',

    'vlrk.statusfinalkomisimarketing_text',
    'vlrk.statusfinalbonustriwulan_text',
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

    const query = db(`${this.viewName} as vlrk`)
      .select(this.EXPORT_COLUMNS)
      .modify((qb: any) => this.applyFilters(qb, safeFilters, search));

    if (sortBy === 'statusaktif') {
      query.orderBy('vlrk.text', 'asc');
    } else if (sortBy === 'statusbank') {
      query.orderBy('vlrk.statusbank_text', sortDirection);
    } else if (sortBy === 'statusdefault') {
      query.orderBy('vlrk.statusdefault_text', sortDirection);
    } else if (sortBy === 'statuslangsungcair') {
      query.orderBy('vlrk.statuslangsungcair_text', sortDirection);
    } else {
      query.orderBy(`vlrk.${sortBy}`, sortDirection);
    }

    return query;
  }

  async countExportRows(
    { search, filters }: Pick<FindAllParams, 'search' | 'filters'>,
    db: any,
  ): Promise<number> {
    const result = await db(`${this.tableName} as vlrk`)
      .count('vlrk.id as total')
      .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
      .first();

    return Number(result?.total ?? 0);
  }

  readonly exportSheet = {
    sheetName: 'Data Export',
    titleLines: [
      'PT. TRANSPORINDO AGUNG SEJAHTERA',
      'LAPORAN LABA RUGI KALKULASI',
      'Data Export',
    ],
    headers: [
      'NO.',
      'PERIODE',
      'EST KOMISI MARKETING',
      'EST KOMISI MARKETING 2',
      'KOMISI MARKETING',
      'BIAYA KANTOR PUSAT',
      'BIAYA TOUR',
      'GAJI DIREKSI',
      'EST KOMISI KACAB',
      'BIAYA BONUS TRI WULAN',
      'EST KOMISI KACAB CABANG 1',
      'EST KOMISI KACAB CABANG 2',
      'STATUS FINAL KOMISI MARKETING',
      'STATUS FINAL BONUS TRI WULAN',
    ],
    columnWidths: [5, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20],
    columnFormats: [
      null, // NO. — default sudah rata kanan
      null, // PERIODE
      { wrapText: true, numFmt: EXCEL_FORMAT.RUPIAH }, // ESTIMASI KOMISI MARKETING 1
      { wrapText: true, numFmt: EXCEL_FORMAT.RUPIAH }, // ESTIMASI KOMISI MARKETING 1
      { wrapText: true, numFmt: EXCEL_FORMAT.RUPIAH }, // KOMISI MARKETING 1
      { wrapText: true, numFmt: EXCEL_FORMAT.RUPIAH }, // BIAYA KANTOR PUSAT
      { wrapText: true, numFmt: EXCEL_FORMAT.RUPIAH }, // BIAYA TOUR
      { wrapText: true, numFmt: EXCEL_FORMAT.RUPIAH }, // GAJI DIREKSI
      { wrapText: true, numFmt: EXCEL_FORMAT.RUPIAH }, // ESTIMASI KOMISI KACAB
      { wrapText: true, numFmt: EXCEL_FORMAT.RUPIAH }, // BIAYA TRIWULAN MARKETING
      { wrapText: true, numFmt: EXCEL_FORMAT.RUPIAH }, // ESTIMASI KOMISI KACAB CABANG 1
      { wrapText: true, numFmt: EXCEL_FORMAT.RUPIAH }, // ESTIMASI KOMISI KACAB CABANG 2
      { wrapText: true, align: 'center' as const }, // STATUS FINAL KOMISI
      { wrapText: true, align: 'center' as const }, // STATUS FINAL BONUS
    ],
    mapRow: (row: any, rowNumber: number) => [
      rowNumber,
      row.periode,
      row.estkomisimarketing,
      row.estkomisimarketing2,
      row.komisimarketing,
      row.biayakantorpusat,
      row.biayatour,
      row.gajidireksi,
      row.estkomisikacab,
      row.biayabonustriwulan,
      row.estkomisikacabcabang1,
      row.estkomisikacabcabang2,
      row.statusfinalkomisimarketing_text,
      row.statusfinalbonustriwulan_text,
    ],
  };

  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:K1');
    worksheet.mergeCells('A2:K2');
    worksheet.mergeCells('A3:K3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN LABA RUGI KALKULASI';
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
      'PERIODE',
      'EST KOMISI MARKETING',
      'EST KOMISI MARKETING 2',
      'KOMISI MARKETING',
      'BIAYA KANTOR PUSAT',
      'BIAYA TOUR',
      'GAJI DIREKSI',
      'EST KOMISI KACAB',
      'BIAYA BONUS TRI WULAN',
      'EST KOMISI KACAB CABANG 1',
      'EST KOMISI KACAB CABANG 2',
      'STATUS FINAL KOMISI MARKETING',
      'STATUS FINAL BONUS TRI WULAN',
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
        row.periode,
        row.estkomisimarketing,
        row.komisimarketing,
        row.biayakantorpusat,
        row.biayatour,
        row.gajidireksi,
        row.estkomisikacab,
        row.biayabonustriwulan,
        row.estkomisimarketing2,
        row.estkomisikacabcabang1,
        row.estkomisikacabcabang2,
        row.statusfinalkomisi_nama,
        row.statusfinalbonus_nama,
      ];
      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);

        if (colIndex === 1) {
          cell.value = value ?? '';
          cell.alignment = {
            horizontal: 'left',
            vertical: 'middle',
          };
        } else if (colIndex === 0) {
          cell.value = value ?? '';
          cell.alignment = {
            horizontal: 'right',
            vertical: 'middle',
          };
        } else if (colIndex === 12 || colIndex === 13) {
          cell.value = value ?? '';
          cell.alignment = {
            horizontal: 'right',
            vertical: 'middle',
          };
        } else {
          cell.value = Number(value);
          cell.numFmt = '#,##0.00';
          cell.alignment = {
            horizontal: 'right',
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
    worksheet.getColumn(4).width = 20;

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_labarugi_kalkulasi_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
