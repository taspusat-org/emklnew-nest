import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { CreateAlatbayarDto } from './dto/create-alatbayar.dto';
import { UpdateAlatbayarDto } from './dto/update-alatbayar.dto';
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

@Injectable()
export class AlatbayarService {
  private readonly logger = new Logger(AlatbayarService.name);
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
  ) {}
  private readonly tableName = 'alatbayar';
  private readonly viewName = 'valatbayar';

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
            // pakai query, bukan qb — statement yang ditambahkan ke qb saat
            // callback grup dievaluasi tidak ikut ter-compile (hilang diam-diam)
            query.orWhereRaw("TO_CHAR(ab.??, 'DD-MM-YYYY HH24:MI:SS') like ?", [
              field,
              `%${sanitizedValue}%`,
            ]);
          } else {
            query.orWhere(field, 'like', `%${sanitizedValue}%`);
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
        qb.andWhereRaw("TO_CHAR(ab.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else {
        // ✅ prefix ab. agar konsisten dengan alias view
        qb.andWhere(`ab.${key}`, 'like', `%${sanitizedValue}%`);
      }
    });
  }

  private buildInsertData(dto: any, uuid?: string): Record<string, any> {
    return {
      id: uuid ? uuid : dto.uuid, // id (uuidV7)
      nama: dto.nama ? dto.nama.toUpperCase() : null,
      keterangan: dto.keterangan ? dto.keterangan.toUpperCase() : null,
      statuslangsungcair: dto.statuslangsungcair,
      statuslangsungcair_uuid: dto.statuslangsungcair_uuid,
      statusdefault: dto.statusdefault,
      statusdefault_uuid: dto.statusdefault_uuid,
      statusbank: dto.statusbank,
      statusbank_uuid: dto.statusbank_uuid,
      statusaktif: dto.statusaktif,
      statusaktif_uuid: dto.statusaktif_uuid,
      modifiedby: dto.modifiedby,
      created_at: dto.created_at || this.utilsService.getTime(),
      updated_at: dto.updated_at || this.utilsService.getTime(),
    };
  }

  async create(CreateAlatbayarDto: any, trx: any) {
    try {
      const { sortBy, sortDirection, filters, search, page, limit, info } =
        CreateAlatbayarDto;

      const uuid = await uuidV7(trx);

      const insertData = this.buildInsertData(CreateAlatbayarDto, uuid);
      await trx(this.tableName).insert(insertData);
      const newItem = await trx(this.viewName).orderBy('id', 'desc').first();

      const existingData = await trx(this.viewName)
        .where('id', newItem.id)
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();

      // 3. Hitung posisi & total dengan filter yang sama
      let posisi: number;
      let totalItems: number;

      // totalItems selalu dihitung dengan filter — fix bug utama
      const totalRecords = await trx(this.viewName)
        .count('id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      totalItems = Number(totalRecords?.total ?? 0);

      if (existingData) {
        const resultposition = await trx(this.viewName) // fix: pakai this.tableName, bukan hardcode 'valatbayar'
          .count('* as posisi')
          .where(
            sortBy,
            sortDirection === 'desc' ? '>=' : '<=',
            insertData[sortBy],
          )
          .where('id', '<=', newItem.id) // fix: tidak perlu query LastId terpisah
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
          postingdari: 'ADD ALAT-BAYAR',
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
      throw new Error(`Error creating alat bayar: ${error.message}`);
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

      const sortBy = sort?.sortBy || 'nama'; // fix: was 'creditlimit'
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'asc' ? 'asc' : 'desc';
      const safeFilters = filters || {};
      // Count dari tabel base (tanpa ROW_NUMBER overhead)
      const countResult = await trx(`${this.viewName} as ab`)
        .count('ab.id as total')
        .modify((qb) => this.applyFilters(qb, safeFilters, search))
        .first();
      const total = Number(countResult?.total ?? 0);

      // Data dari view (mengandung _text, _memo, dll)
      const query = trx(`${this.viewName} as ab`).select([
        'ab.id',
        'ab.uuid',
        'ab.nama',
        'ab.keterangan',
        'ab.statuslangsungcair',
        'ab.statusdefault',
        'ab.statusbank',
        'ab.statusaktif',
        'ab.statusaktif_uuid',
        'ab.statuslangsungcair_text',
        'ab.statuslangsungcair_uuid',
        'ab.statuslangsungcair_memo',
        'ab.statusdefault_text',
        'ab.statusdefault_uuid',
        'ab.statusdefault_memo',
        'ab.statusbank_text',
        'ab.statusbank_uuid',
        'ab.statusbank_memo',
        'ab.text',
        'ab.memo',
        'ab.info',
        'ab.modifiedby',
        trx.raw(
          "TO_CHAR(ab.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
        ),
        trx.raw(
          "TO_CHAR(ab.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
        ),
      ]);

      query.modify((qb) => this.applyFilters(qb, safeFilters, search));

      if (sortBy === 'statusaktif') {
        query.orderBy('ab.text', 'asc');
      } else if (sortBy === 'statusbank') {
        query.orderBy('ab.statusbank_text', sortDirection);
      } else if (sortBy === 'statusdefault') {
        query.orderBy('ab.statusdefault_text', sortDirection);
      } else if (sortBy === 'statuslangsungcair') {
        query.orderBy('ab.statuslangsungcair_text', sortDirection);
      } else {
        query.orderBy(`ab.${sortBy}`, sortDirection);
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
      this.logger.error('Error fetching alatbayar data', error?.stack);
      throw new InternalServerErrorException('Failed to fetch alatbayar data');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      const safeId = Number(id);
      if (!Number.isInteger(safeId) || safeId <= 0) {
        throw new Error('Invalid id');
      }

      const tStart = Date.now();
      const tag = `[update id=${safeId} t=${tStart}]`;
      console.log(`${tag} START at ${new Date().toISOString()}`);

      // Pakai sp_getapplock dgn @LockTimeout = 0. Return value: 0/1 = granted,
      // < 0 = tidak dapat lock. Output via OUTPUT param @r dlm SELECT.
      const lockResource = `alatbayar_${safeId}`;
      console.log(`${tag} calling sp_getapplock '${lockResource}'`);
      const lockResult = await trx.raw(`
        DECLARE @r int;
        EXEC @r = sp_getapplock
          @Resource = '${lockResource}',
          @LockMode = 'Exclusive',
          @LockOwner = 'Transaction',
          @LockTimeout = 0;
        SELECT @r AS r;
      `);
      const tAfterLock = Date.now();
      console.log(
        `${tag} sp_getapplock returned in ${tAfterLock - tStart}ms, raw result:`,
        JSON.stringify(lockResult),
      );

      const lockReturn = Array.isArray(lockResult)
        ? lockResult[0]?.r
        : lockResult?.[0]?.r;
      console.log(`${tag} parsed lockReturn:`, lockReturn);

      if (typeof lockReturn === 'number' && lockReturn < 0) {
        console.log(`${tag} LOCK CONFLICT → throwing 1222`);
        const err: any = new Error(
          'Data sedang diproses transaksi lain, silakan coba lagi.',
        );
        err.number = 1222;
        throw err;
      }
      console.log(`${tag} LOCK ACQUIRED, proceeding`);

      // Uniqueness check 'nama' — dijalankan di dalam transaction (bukan di
      // ZodValidationPipe seperti sebelumnya). Pakai trx supaya self-lock
      // tidak konflik, dan kalau ada req lain yg pegang applock 'alatbayar_X'
      // untuk row yg matching, sp_getapplock di atas sudah filter duluan.
      if (data?.nama) {
        const dupRows = await trx.raw(
          `SELECT TOP 1 id FROM [${this.tableName}] WHERE nama = ? AND id <> ?`,
          [String(data.nama).toUpperCase(), safeId],
        );
        const dupRow = Array.isArray(dupRows) ? dupRows[0] : dupRows?.[0];
        if (dupRow) {
          const err: any = new Error('Alat Bayar dengan nama ini sudah ada');
          err.status = 400;
          throw err;
        }
      }

      const existedRows = await trx.raw(
        `SELECT TOP 1 * FROM [${this.tableName}] WHERE id = ${safeId}`,
      );
      const existedData = Array.isArray(existedRows)
        ? existedRows[0]
        : existedRows?.[0];

      if (!existedData) {
        throw new Error('Alat Bayar not found');
      }
      const { sortBy, sortDirection, filters, search, limit } = data;
      // Uppercase hanya kolom teks manusiawi (nama, keterangan). id, uuid, dan
      // status* adalah UUID bertipe text (case-sensitive); blanket uppercase
      // memindahkan PK sehingga update 500 (lihat alatbayar.service.ts).
      ['nama', 'keterangan'].forEach((field) => {
        if (typeof data[field] === 'string') {
          data[field] = data[field].toUpperCase();
        }
      });
      // 2. Build insert payload — uppercase hanya nama & keterangan,
      //    sama persis seperti create, via buildInsertData()
      const insertData = this.buildInsertData(data);

      const hasChanges = this.utilsService.hasChanges(insertData, existedData);

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(insertData);
      }

      const existingData = await trx(this.viewName)
        .where('id', id)
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();

      // 3. Hitung posisi & total dengan filter yang sama
      let posisi: number;
      let totalItems: number;

      // totalItems selalu dihitung dengan filter — fix bug utama
      const totalRecords = await trx(this.viewName)
        .count('id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      totalItems = Number(totalRecords?.total ?? 0);
      const LastId = await trx(this.viewName)
        .select('id')
        .orderBy('id', 'desc')
        .first();
      if (existingData) {
        const resultposition = await trx(this.viewName) // fix: pakai this.tableName, bukan hardcode 'valatbayar'
          .count('* as posisi')
          .where(
            sortBy,
            sortDirection === 'desc' ? '>=' : '<=',
            insertData[sortBy],
          )
          .where('id', '<=', LastId.id) // fix: tidak perlu query LastId terpisah
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
          postingdari: 'EDIT ALAT BAYAR',
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
      console.error('Error updating Alat Bayar:', error);
      throw error; // ← lempar error asli, jangan dibungkus, agar code 1222 sampai ke controller
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
          postingdari: 'DELETE ALAT-BAYAR',
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

    worksheet.mergeCells('A1:G1');
    worksheet.mergeCells('A2:G2');
    worksheet.mergeCells('A3:G3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN ALAT BAYAR';
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
      'STATUS LANGSUNG CAIR',
      'STATUS DEFAULT',
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
        row.statuslangsungcair_text,
        row.statusdefault_text,
        row.statusbank_text,
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

    const adjustCols = [5, 6, 7];
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
      `laporan_alatbayar_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
