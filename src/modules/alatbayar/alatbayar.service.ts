import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
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
      const sanitizedValue = String(search).trim();
      qb.where((query) => {
        searchFields.forEach((field) => {
          if (['created_at', 'updated_at'].includes(field)) {
            qb.orWhereRaw("to_char(ab.??, 'DD-MM-YYYY HH24:MI:SS') ilike ?", [
              field,
              `%${sanitizedValue}%`,
            ]);
          } else {
            query.orWhere(field, 'ilike', `%${sanitizedValue}%`);
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
        qb.andWhereRaw("to_char(ab.??, 'DD-MM-YYYY HH24:MI:SS') ilike ?", [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else {
        // ✅ prefix ab. agar konsisten dengan alias view
        qb.andWhere(`ab.${key}`, 'ilike', `%${sanitizedValue}%`);
      }
    });
  }

  private buildInsertData(dto: any, uuid?: string): Record<string, any> {
    return {
      id: uuid ? uuid : dto.uuid, // id (uuidV7)
      nama: dto.nama ? dto.nama.toUpperCase() : null,
      keterangan: dto.keterangan ? dto.keterangan.toUpperCase() : null,
      statuslangsungcair: dto.statuslangsungcair,
      statusdefault: dto.statusdefault,
      statusbank: dto.statusbank,
      statusaktif: dto.statusaktif,
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
        return { col: 'text', dir: 'asc' }; // findAll: hardcode 'asc' on ab.text
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

  async create(CreateAlatbayarDto: any, trx: any) {
    try {
      const { sortBy, sortDirection, filters, search, page, limit, info } =
        CreateAlatbayarDto;

      const uuid = await uuidV7(trx);

      const insertData = this.buildInsertData(CreateAlatbayarDto, uuid);
      await trx(this.tableName).insert(insertData);
      // id sekarang varchar UUID (bukan auto-increment), jadi
      // orderBy('id','desc').first() TIDAK mengembalikan baris yang baru
      // diinsert — id UUID tidak terurut secara kronologis. Ambil langsung
      // by uuid yang baru kita generate & insert supaya fokus baris setelah
      // simpan menunjuk ke data yang benar.
      const newItem = await trx(this.viewName).where('id', uuid).first();

      const existingData = await trx(`${this.viewName} as ab`)
        .where('id', newItem.id)
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();

      // 3. Hitung posisi & total dengan filter yang sama
      let posisi: number;
      let totalItems: number;

      // totalItems selalu dihitung dengan filter — fix bug utama
      const totalRecords = await trx(`${this.viewName} as ab`)
        .count('id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      totalItems = Number(totalRecords?.total ?? 0);

      if (existingData) {
        // Hitung posisi memakai kolom & arah yang SAMA dengan urutan tampil grid
        // (findAll). Untuk kolom status, bandingkan nilai TEKS dari baris view,
        // bukan id UUID — supaya fokus baris setelah simpan tepat.
        const { col: posCol, dir: posDir } = this.resolvePositionOrder(
          sortBy,
          sortDirection,
        );
        const resultposition = await trx(`${this.viewName} as ab`)
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
      // Count dari tabel BASE (alatbayar), bukan view valatbayar. View hanya
      // menambah kolom _text/_memo lewat LEFT JOIN ke parameter — LEFT JOIN tidak
      // pernah mengubah jumlah baris, jadi count base == count view tapi tanpa
      // overhead 4 JOIN (pada ~1jt baris: ~297ms -> ~119ms). applyFilters hanya
      // mereferensikan kolom yang ada di tabel base (nama, keterangan, status*,
      // created_at, updated_at, modifiedby) sehingga hasilnya identik.
      const countResult = await trx(`${this.tableName} as ab`)
        .count('ab.id as total')
        .modify((qb) => this.applyFilters(qb, safeFilters, search))
        .first();
      const total = Number(countResult?.total ?? 0);

      // Lookup dengan hasil > 500 baris: JANGAN tarik semua baris. Path lookup
      // tidak mengirim limit (limit=0) sehingga query mengambil SELURUH tabel —
      // alatbayar ~1jt baris → serialisasi JSON melempar "RangeError: Invalid
      // string length" (melebihi batas panjang string V8) → 500. Balas
      // type:'json' tanpa data agar komponen LookUp beralih ke server-side
      // search, konsisten dgn responseType path normal (>500 → 'json') dan guard
      // di PengeluaranheaderService.findAll.
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
          "to_char(ab.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
        ),
        trx.raw(
          "to_char(ab.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
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
      console.log(query.toQuery());
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
      console.log('data', data);
      const existedData = await trx(this.tableName).where('id', id).first();

      if (!existedData) {
        throw new Error('Alat Bayar not found');
      }

      const { sortBy, sortDirection, filters, search, limit } = data;
      // JANGAN blanket-uppercase semua field string. id, uuid, dan status*
      // adalah UUID bertipe TEXT (case-sensitive). Meng-uppercase-nya mengubah
      // nilai: id lowercase (mis. 02-019f5ea1-..) jadi 02-019F5EA1-.. sehingga
      // PK berubah & FK status* bisa tak match. Uppercase nama & keterangan
      // sudah ditangani buildInsertData().
      // 2. Build insert payload — uppercase hanya nama & keterangan,
      //    sama persis seperti create, via buildInsertData()
      const insertData = this.buildInsertData(data);
      // id = kunci WHERE (PK), bukan kolom yang di-SET saat update.
      // buildInsertData mengisi id dari dto.uuid; kalau ikut ter-UPDATE, PK
      // berpindah dan lookup `updatedItem` (by id lama) gagal -> updatedItem
      // undefined -> updatedItem.id throw -> 500. created_at juga jangan ditimpa
      // saat edit (buildInsertData mengisinya dengan now() bila dto kosong).
      delete insertData.id;
      delete insertData.created_at;

      const hasChanges = this.utilsService.hasChanges(insertData, existedData);

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(insertData);
      }

      // Ambil baris yang SUDAH diperbarui dari view — sama persis seperti create
      // mengambil `newItem` by uuid. View memuat kolom turunan (_text/_uuid/
      // _memo) yang tidak ada di tabel base; dipakai untuk acuan posisi dan
      // sebagai data balikan agar polanya konsisten dengan ADD. Query tanpa
      // filter supaya baris selalu ketemu walau hasil edit tak lagi cocok
      // dengan filter aktif.
      const updatedItem = await trx(this.viewName).where('id', id).first();

      const existingData = await trx(`${this.viewName} as ab`)
        .where('id', updatedItem.id)
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();

      // 3. Hitung posisi & total dengan filter yang sama
      let posisi: number;
      let totalItems: number;

      // totalItems selalu dihitung dengan filter — fix bug utama
      const totalRecords = await trx(`${this.viewName} as ab`)
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
        const resultposition = await trx(`${this.viewName} as ab`)
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
          postingdari: 'EDIT ALAT BAYAR',
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
      console.error('Error updating Alat Bayar:', error);
      throw new Error('Failed to update Alat Bayar');
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
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }

  /** Kolom yang benar-benar dipakai file export — bukan seluruh kolom view. */
  private readonly EXPORT_COLUMNS = [
    'ab.nama',
    'ab.keterangan',
    'ab.statuslangsungcair_text',
    'ab.statusdefault_text',
    'ab.statusbank_text',
    'ab.text',
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
    { search, filters, sort }: Pick<FindAllParams, 'search' | 'filters' | 'sort'>,
    db: any,
  ) {
    const safeFilters = filters || {};
    const sortBy = sort?.sortBy || 'nama';
    const sortDirection =
      sort?.sortDirection?.toLowerCase() === 'asc' ? 'asc' : 'desc';

    const query = db(`${this.viewName} as ab`)
      .select(this.EXPORT_COLUMNS)
      .modify((qb: any) => this.applyFilters(qb, safeFilters, search));

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
    const result = await db(`${this.tableName} as ab`)
      .count('ab.id as total')
      .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
      .first();

    return Number(result?.total ?? 0);
  }

  /** Definisi sheet export — dipakai jalur background (streaming). */
  readonly exportSheet = {
    sheetName: 'Data Export',
    titleLines: [
      'PT. TRANSPORINDO AGUNG SEJAHTERA',
      'LAPORAN ALAT BAYAR',
      'Data Export',
    ],
    headers: [
      'NO.',
      'NAMA',
      'KETERANGAN',
      'STATUS LANGSUNG CAIR',
      'STATUS DEFAULT',
      'STATUS BANK',
      'STATUS AKTIF',
    ],
    // Mode streaming tidak bisa auto-fit, jadi lebarnya ditetapkan di sini.
    mapRow: (row: any, rowNumber: number) => [
      rowNumber,
      row.nama,
      row.keterangan,
      row.statuslangsungcair_text,
      row.statusdefault_text,
      row.statusbank_text,
      row.text,
    ],
  };

  /**
   * Merakit workbook Excel dan mengembalikannya sebagai buffer.
   *
   * Hanya untuk export kecil (endpoint GET /alatbayar/export yang lama):
   * seluruh data ditampung di memori. Export lewat background job memakai
   * ExportJobService yang streaming.
   */
  async buildExcelBuffer(data: any[]): Promise<Buffer> {
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
      `laporan_alatbayar_${Date.now()}.xlsx`,
    );
    await fs.promises.writeFile(tempFilePath, buffer);

    return tempFilePath;
  }
}
