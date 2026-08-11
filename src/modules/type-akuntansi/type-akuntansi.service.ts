import {
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Column, Workbook } from 'exceljs';
import {
  calculateItemIndex,
  getFetchedPages,
  UtilsService,
  uuidV7,
} from 'src/utils/utils.service';
import { GlobalService } from '../global/global.service';
import { RedisService } from 'src/common/redis/redis.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { LocksService } from '../locks/locks.service';

@Injectable()
export class TypeAkuntansiService {
  private readonly logger = new Logger(TypeAkuntansiService.name);
  private readonly tableName: string = 'typeakuntansi';

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly globalService: GlobalService,
    private readonly locksService: LocksService,
    private readonly logTrailService: LogtrailService,
    private readonly utilsService: UtilsService,
  ) {}

  /**
   * Tabel `typeakuntansi` tidak punya view turunan seperti `valatbayar`, jadi
   * kolom teks status (p.text) dan nama akuntansi (ak.nama) diambil lewat LEFT
   * JOIN. Query dasar ini dipakai findAll, COUNT, dan perhitungan posisi baris
   * supaya ketiganya melihat dataset yang PERSIS sama.
   */
  private baseQuery(trx: any) {
    return trx(`${this.tableName} as u`)
      .leftJoin('parameter as p', 'u.statusaktif', 'p.id')
      .leftJoin('akuntansi as ak', 'u.akuntansi_id', 'ak.id');
  }

  private selectColumns(trx: any) {
    return [
      'u.id as id',
      'u.nama',
      'u.order',
      'u.keterangan',
      'u.akuntansi_id',
      'u.statusaktif',
      'u.modifiedby',
      trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
      trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
      'p.memo',
      'p.text as statusaktif_text',
      'ak.nama as akuntansi_nama',
    ];
  }

  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    // statusaktif dikirim sebagai id parameter (varchar UUID) oleh FilterOptions,
    // jadi percuma ikut dicari pada search global yang berisi teks.
    const excludeSearchKeys = ['statusaktif', 'text', 'icon'];

    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );
    const dateFields = ['created_at', 'updated_at'];
    // `order` bertipe integer: Postgres tidak punya operator `integer ILIKE
    // text`, jadi harus di-CAST dulu sebelum dicocokkan sebagai teks.
    const numericFields = ['order'];

    if (search && searchFields.length > 0) {
      const sanitizedValue = String(search).trim();
      qb.where((query) => {
        searchFields.forEach((field) => {
          if (dateFields.includes(field)) {
            query.orWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
              field,
              `%${sanitizedValue}%`,
            ]);
          } else if (numericFields.includes(field)) {
            query.orWhereRaw('CAST(u.?? AS TEXT) ILIKE ?', [
              field,
              `%${sanitizedValue}%`,
            ]);
          } else if (field === 'akuntansi') {
            query.orWhere('ak.nama', 'ilike', `%${sanitizedValue}%`);
          } else {
            query.orWhere(`u.${field}`, 'ilike', `%${sanitizedValue}%`);
          }
        });
      });
    }

    Object.entries(filters || {}).forEach(([key, rawValue]) => {
      if (rawValue === null || rawValue === undefined || rawValue === '')
        return;

      const sanitizedValue = String(rawValue);
      if (dateFields.includes(key)) {
        qb.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else if (numericFields.includes(key)) {
        qb.andWhereRaw('CAST(u.?? AS TEXT) ILIKE ?', [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else if (key === 'statusaktif_text' || key === 'memo') {
        qb.andWhere('p.text', '=', sanitizedValue);
      } else if (key === 'akuntansi') {
        qb.andWhere('ak.nama', 'ilike', `%${sanitizedValue}%`);
      } else {
        qb.andWhere(`u.${key}`, 'ilike', `%${sanitizedValue}%`);
      }
    });
  }

  /**
   * Payload insert/update dibangun EKSPLISIT dari kolom tabel supaya field
   * bantu dari frontend (sortBy, filters, statusaktif_text, akuntansi_nama,
   * method, dll) tidak ikut ditulis -> "Invalid column name". Uppercase HANYA
   * nama & keterangan: id, akuntansi_id, dan statusaktif adalah uuid v7 HURUF
   * KECIL — meng-uppercase-nya menulis id yang tidak ada sehingga relasi
   * akuntansi/status tampil kosong dan perubahan terlihat "tidak tersimpan".
   */
  private buildInsertData(dto: any, uuid?: string): Record<string, any> {
    return {
      id: uuid ? uuid : dto.id,
      nama: dto.nama ? dto.nama.toUpperCase() : null,
      order: dto.order ?? null,
      keterangan: dto.keterangan ? dto.keterangan.toUpperCase() : null,
      akuntansi_id: dto.akuntansi_id ?? null,
      statusaktif: dto.statusaktif,
      info: dto.info ?? null,
      modifiedby: dto.modifiedby,
      created_at: dto.created_at || this.utilsService.getTime(),
      updated_at: dto.updated_at || this.utilsService.getTime(),
    };
  }

  /**
   * Kolom + arah urut yang dipakai untuk menghitung posisi baris. WAJIB
   * mereplikasi orderBy di findAll(): grid mengurutkan kolom status memakai
   * TEKS parameter (p.text) dan kolom akuntansi memakai ak.nama, bukan id
   * UUID-nya. Kalau tidak sama, fokus baris setelah simpan akan meleset.
   */
  private resolvePositionOrder(
    sortBy: string,
    sortDirection: string,
  ): { orderCol: string; dir: 'asc' | 'desc' } {
    const dir = sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
    switch (sortBy) {
      case 'statusaktif':
      case 'statusaktif_text':
      case 'text':
        return { orderCol: 'p.text', dir };
      case 'akuntansi':
      case 'akuntansi_nama':
      case 'akuntansi_text':
        return { orderCol: 'ak.nama', dir };
      default:
        return { orderCol: `u.${sortBy}`, dir };
    }
  }

  /**
   * Posisi (1-based) baris `id` pada dataset yang sedang tampil di grid:
   * jumlah baris yang urutannya <= (asc) / >= (desc) baris tersebut, dengan
   * filter + search yang sama. Nilai pembanding diambil MENTAH dari database
   * (lewat alias `posval`), bukan dari hasil select yang sudah di-TO_CHAR,
   * supaya sort kolom tanggal/angka dibandingkan sebagai tanggal/angka.
   */
  private async resolvePosition(
    trx: any,
    id: string,
    filters: Record<string, any>,
    search: string | undefined,
    sortBy: string,
    sortDirection: string,
  ): Promise<number> {
    const { orderCol, dir } = this.resolvePositionOrder(sortBy, sortDirection);

    const existingData = await this.baseQuery(trx)
      .select({ posval: orderCol })
      .where('u.id', id)
      .modify((qb) => this.applyFilters(qb, filters, search))
      .first();

    // Baris tidak lolos filter aktif (mis. habis diedit jadi tidak cocok) ->
    // jatuhkan fokus ke baris pertama daripada menghitung posisi yang salah.
    if (!existingData || existingData.posval === null) return 1;

    const resultposition = await this.baseQuery(trx)
      .count('* as posisi')
      .where(orderCol, dir === 'desc' ? '>=' : '<=', existingData.posval)
      .modify((qb) => this.applyFilters(qb, filters, search))
      .first();

    const posisi = Number(resultposition?.posisi ?? 0);
    return posisi > 0 ? posisi : 1;
  }

  /**
   * Rakit window halaman di sekitar `posisi` lalu balikan datanya per halaman.
   * Satu kali findAll dengan customOffset, dipecah di memory — bukan menarik
   * SELURUH tabel lalu findIndex seperti implementasi lama.
   */
  private async buildPagedResult(
    trx: any,
    posisi: number,
    totalItems: number,
    limit: number,
    sortBy: string,
    sortDirection: string,
    filters: Record<string, any>,
    search: string | undefined,
  ) {
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
        sort: { sortBy, sortDirection: sortDirection as 'asc' | 'desc' },
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

    await this.redisService.set(
      `${this.tableName}-page-${pageNumber}`,
      JSON.stringify(allFetchedData),
    );

    return {
      itemIndex: itemIndex.zeroBasedIndex < 0 ? 0 : itemIndex.zeroBasedIndex,
      pageNumber,
      fetchedPages,
      pagedData,
    };
  }

  async create(createData: any, trx: any) {
    try {
      const { sortBy, sortDirection, filters, search, limit } = createData;

      const sortColumn = sortBy || 'nama';
      const sortDir = sortDirection || 'asc';
      const pageLimit = Number(limit) > 0 ? Number(limit) : 10;

      const uuid = await uuidV7(trx);
      await trx(this.tableName).insert(this.buildInsertData(createData, uuid));

      // id berupa varchar UUID (bukan auto-increment), jadi orderBy('id','desc')
      // TIDAK mengembalikan baris yang baru diinsert. Ambil langsung by uuid
      // yang barusan digenerate supaya fokus baris setelah simpan tepat.
      const newItem = await this.baseQuery(trx)
        .select(this.selectColumns(trx))
        .where('u.id', uuid)
        .first();

      // totalItems SELALU dihitung dengan filter yang sama seperti grid.
      const totalRecords = await this.baseQuery(trx)
        .count('u.id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      const totalItems = Number(totalRecords?.total ?? 0);

      const posisi = await this.resolvePosition(
        trx,
        uuid,
        filters,
        search,
        sortColumn,
        sortDir,
      );

      const paged = await this.buildPagedResult(
        trx,
        posisi,
        totalItems,
        pageLimit,
        sortColumn,
        sortDir,
        filters,
        search,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD TYPE AKUNTANSI',
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      return { newItem, ...paged };
    } catch (error) {
      throw new Error(`Error creating type akuntansi: ${error.message}`);
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
      const { page = 1, customOffset } = pagination ?? {};
      let limit = pagination?.limit ?? 0;

      const sortBy = sort?.sortBy || 'nama';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
      const safeFilters = filters || {};

      // Count HARUS memakai filter & search yang sama dengan query data —
      // memakai COUNT tanpa filter (implementasi lama) membuat totalPages dan
      // posisi baris ikut salah begitu ada filter kolom / search aktif.
      const countResult = await this.baseQuery(trx)
        .count('u.id as total')
        .modify((qb) => this.applyFilters(qb, safeFilters, search))
        .first();
      const total = Number(countResult?.total ?? 0);

      if (isLookUp) {
        // Hasil lookup > 500 baris: jangan tarik semuanya, biarkan komponen
        // LookUp beralih ke pencarian server-side.
        if (total > 500) {
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
        limit = 0; // <= 500: kirim seluruh baris, difilter di client.
      }

      const query = this.baseQuery(trx).select(this.selectColumns(trx));
      query.modify((qb) => this.applyFilters(qb, safeFilters, search));

      const { orderCol } = this.resolvePositionOrder(sortBy, sortDirection);
      query.orderBy(orderCol, sortDirection);

      const offset =
        useCustomOffset === true && customOffset !== undefined
          ? customOffset
          : (page - 1) * limit;

      if (limit > 0) {
        query.offset(offset).limit(limit);
      }

      const data = await query;
      const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
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
      this.logger.error('Error fetching type akuntansi data', error?.stack);
      throw new InternalServerErrorException(
        'Failed to fetch type akuntansi data',
      );
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      const existedData = await trx(this.tableName).where('id', id).first();

      if (!existedData) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Data Not Found!',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const { sortBy, sortDirection, filters, search, limit } = data;

      const sortColumn = sortBy || 'nama';
      const sortDir = sortDirection || 'asc';
      const pageLimit = Number(limit) > 0 ? Number(limit) : 10;

      const insertData = this.buildInsertData(data);
      // id = kunci WHERE (PK) yang datang dari path param, bukan kolom yang
      // di-SET. created_at juga jangan ditimpa saat edit (buildInsertData
      // mengisinya dengan now() bila kosong).
      delete insertData.id;
      delete insertData.created_at;

      const hasChanges = this.utilsService.hasChanges(insertData, existedData);

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(insertData);
      }

      // Ambil baris yang SUDAH diperbarui (tanpa filter) supaya selalu ketemu
      // walau hasil edit tak lagi cocok dengan filter aktif.
      const updatedItem = await this.baseQuery(trx)
        .select(this.selectColumns(trx))
        .where('u.id', id)
        .first();

      const totalRecords = await this.baseQuery(trx)
        .count('u.id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      const totalItems = Number(totalRecords?.total ?? 0);

      const posisi = await this.resolvePosition(
        trx,
        id,
        filters,
        search,
        sortColumn,
        sortDir,
      );

      const paged = await this.buildPagedResult(
        trx,
        posisi,
        totalItems,
        pageLimit,
        sortColumn,
        sortDir,
        filters,
        search,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT TYPE AKUNTANSI',
          idtrans: updatedItem.id,
          nobuktitrans: updatedItem.id,
          aksi: 'EDIT',
          datajson: JSON.stringify(updatedItem),
          modifiedby: updatedItem.modifiedby,
        },
        trx,
      );

      return { updatedItem, ...paged };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      console.error('Error updating type akuntansi:', error);
      throw new Error('Failed to update type akuntansi');
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
          postingdari: 'DELETE TYPE AKUNTANSI',
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
      if (error instanceof NotFoundException) {
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
        const validasi = await this.globalService.checkUsed(
          'akunpusat',
          'type_id',
          value,
          trx,
        );

        return validasi;
      }
    } catch (error) {
      console.error('Error di checkValidasi:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }

  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:F1');
    worksheet.mergeCells('A2:F2');
    worksheet.mergeCells('A3:F3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN TYPE AKUNTANSI';
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
      'NAMA',
      'ORDER',
      'KETERANGAN',
      'AKUNTANSI',
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
        row.order,
        row.keterangan,
        row.akuntansi_nama,
        row.statusaktif_text,
      ];

      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);

        if (colIndex === 2) {
          cell.value = Number(value);
          cell.numFmt = '0'; // angka polos tanpa ribuan / desimal
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

        cell.font = { name: 'Tahoma', size: 10 };
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
      `laporan_type_akuntansi_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
