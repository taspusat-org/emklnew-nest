import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { RedisService } from 'src/common/redis/redis.service';
import {
  calculateItemIndex,
  formatDateToSQL,
  getFetchedPages,
  UtilsService,
  uuidV7,
} from 'src/utils/utils.service';
import { toNumber } from 'src/utils/field-helpers';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { RelasiService } from '../relasi/relasi.service';
import * as fs from 'fs';
import * as path from 'path';
import { Workbook, Column } from 'exceljs';
import { Knex } from 'knex';
import { EXCEL_FORMAT } from 'src/common/report/export-job.service';

@Injectable()
export class SupplierService {
  private readonly logger = new Logger(SupplierService.name);
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly relasiService: RelasiService,
  ) {}
  private readonly tableName = 'supplier';
  private readonly viewName = 'vsupplier';

  /**
   * id parameter STATUS RELASI 'SUPPLIER' — penanda jenis mitra di tabel relasi.
   * parameter.text tersimpan HURUF BESAR, jadi dibandingkan lewat upper(trim()).
   */
  private async getStatusRelasiId(trx: any): Promise<string> {
    const statusRelasi = await trx('parameter')
      .select('id')
      .where('grp', 'STATUS RELASI')
      .whereRaw('upper(trim(text)) = ?', ['SUPPLIER'])
      .first();

    if (!statusRelasi) {
      throw new BadRequestException([
        {
          path: ['relasi_id'],
          message: "Parameter STATUS RELASI 'SUPPLIER' belum ada",
        },
      ]);
    }
    return statusRelasi.id;
  }

  /**
   * Baris tabel relasi untuk supplier ini. Teks di-uppercase oleh RelasiService;
   * id/status (identifier) tidak boleh di-uppercase.
   */
  private buildRelasiData(dto: any, statusrelasi: string): Record<string, any> {
    return {
      statusrelasi,
      nama: dto.nama || null,
      coagiro: dto.coagiro || null,
      coapiutang: dto.coapiu || null,
      coahutang: dto.coahut || null,
      alamat: dto.alamat || null,
      npwp: dto.npwp || null,
      namapajak: dto.namapajak || null,
      alamatpajak: dto.alamatfakturpajak || null,
      statusaktif: dto.statusaktif || null,
      modifiedby: dto.modifiedby,
    };
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
    const dateOnlyFields = ['tglskb', 'tglsk'];
    const numberFields = [
      'creditterm',
      'credittermplus',
      'nominalpph21',
      'nominalpph23',
    ];

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
          } else if (dateOnlyFields.includes(field)) {
            query.orWhereRaw("to_char(u.??, 'DD-MM-YYYY') ilike ?", [
              field,
              `%${sanitizedValue}%`,
            ]);
          } else if (numberFields.includes(field)) {
            query.orWhereRaw('u.??::text ilike ?', [
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
      } else if (dateOnlyFields.includes(key)) {
        qb.andWhereRaw("to_char(u.??, 'DD-MM-YYYY') ilike ?", [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else if (numberFields.includes(key)) {
        qb.andWhereRaw('u.??::text ilike ?', [key, `%${sanitizedValue}%`]);
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
      contactperson: dto.contactperson ? dto.contactperson.toUpperCase() : null,
      ktp: dto.ktp ? dto.ktp.toUpperCase() : null,
      alamat: dto.alamat ? dto.alamat.toUpperCase() : null,
      coa: dto.coa || null,
      coagiro: dto.coagiro || null,
      coapiu: dto.coapiu || null,
      coahut: dto.coahut || null,
      kota: dto.kota ? dto.kota.toUpperCase() : null,
      kodepos: dto.kodepos ? dto.kodepos.toUpperCase() : null,
      telp: dto.telp ? dto.telp.toUpperCase() : null,
      email: dto.email ? dto.email.toUpperCase() : null,
      fax: dto.fax ? dto.fax.toUpperCase() : null,
      web: dto.web ? dto.web.toUpperCase() : null,
      creditterm: toNumber(dto.creditterm),
      credittermplus: toNumber(dto.credittermplus),
      npwp: dto.npwp ? dto.npwp.toUpperCase() : null,
      alamatfakturpajak: dto.alamatfakturpajak
        ? dto.alamatfakturpajak.toUpperCase()
        : null,
      namapajak: dto.namapajak ? dto.namapajak.toUpperCase() : null,
      nominalpph21: toNumber(dto.nominalpph21),
      nominalpph23: toNumber(dto.nominalpph23),
      noskb: dto.noskb ? dto.noskb.toUpperCase() : null,
      tglskb: formatDateToSQL(dto.tglskb),
      nosk: dto.nosk ? dto.nosk.toUpperCase() : null,
      tglsk: formatDateToSQL(dto.tglsk),
      statusaktif: dto.statusaktif || null,
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

  async create(CreateSupplierDto: any, trx: any) {
    try {
      const { sortBy, sortDirection, filters, search, page, limit, info } =
        CreateSupplierDto;

      const uuid = await uuidV7(trx);
      // Baris relasi dibuat LEBIH DULU: kolom relasi_id (NOT NULL, FK ke relasi.id)
      // diisi id-nya, bukan dari input form.
      const relasi = await this.relasiService.create(
        this.buildRelasiData(
          CreateSupplierDto,
          await this.getStatusRelasiId(trx),
        ),
        trx,
      );
      const insertData = this.buildInsertData(CreateSupplierDto, uuid);
      insertData.relasi_id = relasi.id;
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
          postingdari: 'ADD SUPPLIER',
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
      throw new Error(`Error creating supplier: ${error.message}`);
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
        'u.contactperson',
        'u.ktp',
        'u.alamat',
        'u.coa',
        'u.coa_text',
        'u.coagiro',
        'u.coagiro_text',
        'u.coapiu',
        'u.coapiu_text',
        'u.coahut',
        'u.coahut_text',
        'u.kota',
        'u.kodepos',
        'u.telp',
        'u.email',
        'u.fax',
        'u.web',
        'u.creditterm',
        'u.credittermplus',
        'u.npwp',
        'u.alamatfakturpajak',
        'u.namapajak',
        'u.nominalpph21',
        'u.nominalpph23',
        'u.noskb',
        trx.raw("to_char(u.tglskb, 'DD-MM-YYYY') as tglskb"),
        'u.nosk',
        trx.raw("to_char(u.tglsk, 'DD-MM-YYYY') as tglsk"),
        'u.statusaktif',
        'u.statusaktif_text',
        'u.statusaktif_memo',
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
      this.logger.error('Error fetching supplier data', error?.stack);
      throw new InternalServerErrorException('Failed to fetch supplier data');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      const existedData = await trx(this.tableName).where('id', id).first();

      if (!existedData) {
        throw new Error('Supplier not found');
      }

      // Cek unik di DALAM transaksi (lihat NOTE di update-supplier.dto.ts).
      const duplicateNama =
        data.nama &&
        (await trx(this.tableName)
          .whereRaw('lower(trim(??)) = lower(trim(?))', ['nama', data.nama])
          .whereNot('id', id)
          .first());
      if (duplicateNama) {
        throw new BadRequestException([
          { path: ['nama'], message: 'Supplier dengan nama ini sudah ada' },
        ]);
      }

      const { sortBy, sortDirection, filters, search, limit } = data;
      const insertData = this.buildInsertData(data);
      delete insertData.id;
      delete insertData.created_at;

      // Ikut perbarui baris relasi. Data lama yang belum punya relasi dibuatkan sekarang.
      const relasiData = this.buildRelasiData(
        data,
        await this.getStatusRelasiId(trx),
      );
      if (existedData.relasi_id) {
        await this.relasiService.update(existedData.relasi_id, relasiData, trx);
      } else {
        const relasi = await this.relasiService.create(relasiData, trx);
        insertData.relasi_id = relasi.id;
      }

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
          postingdari: 'EDIT SUPPLIER',
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
      console.error('Error updating Supplier:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new Error('Failed to update Supplier');
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
          postingdari: 'DELETE SUPPLIER',
          idtrans: deletedData.id,
          nobuktitrans: deletedData.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby,
        },
        trx,
      );

      // Baris supplier sudah terhapus (FK-nya ke relasi), baru relasinya ikut dihapus.
      if (deletedData.relasi_id) {
        await this.relasiService.delete(deletedData.relasi_id, trx, modifiedby);
      }

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
    'u.contactperson',
    'u.ktp',
    'u.alamat',
    'u.coa_text',
    'u.coagiro_text',
    'u.coapiu_text',
    'u.coahut_text',
    'u.kota',
    'u.kodepos',
    'u.telp',
    'u.email',
    'u.fax',
    'u.web',
    'u.creditterm',
    'u.credittermplus',
    'u.npwp',
    'u.alamatfakturpajak',
    'u.namapajak',
    'u.nominalpph21',
    'u.nominalpph23',
    'u.noskb',
    'u.nosk',
    'u.statusaktif_text',
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
      .select(db.raw("to_char(u.tglskb, 'DD-MM-YYYY') as tglskb"))
      .select(db.raw("to_char(u.tglsk, 'DD-MM-YYYY') as tglsk"))
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
   * Data LaporanSupplier.mrt: baris yang lolos filter & sort grid. Memakai
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
      judullaporan: judullaporan ?? 'Laporan Supplier',
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
      'LAPORAN SUPPLIER',
      'Data Export',
    ],
    headers: [
      'NO.',
      'NAMA',
      'KETERANGAN',
      'CONTACTPERSON',
      'KTP',
      'ALAMAT',
      'COA',
      'COAGIRO',
      'COAPIU',
      'COAHUT',
      'KOTA',
      'KODEPOS',
      'TELP',
      'EMAIL',
      'FAX',
      'WEB',
      'CREDITTERM',
      'CREDITTERMPLUS',
      'NPWP',
      'ALAMATFAKTURPAJAK',
      'NAMAPAJAK',
      'NOMINALPPH21',
      'NOMINALPPH23',
      'NOSKB',
      'TGLSKB',
      'NOSK',
      'TGLSK',
      'STATUSAKTIF',
    ],
    columnWidths: [
      5, 25, 25, 30, 30, 25, 20, 20, 20, 20, 30, 30, 30, 30, 30, 30, 20, 20, 30,
      30, 30, 20, 20, 30, 20, 30, 20, 20,
    ],
    columnFormats: [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      { numFmt: EXCEL_FORMAT.ANGKA },
      { numFmt: EXCEL_FORMAT.ANGKA },
      null,
      null,
      null,
      { numFmt: EXCEL_FORMAT.ANGKA_DESIMAL },
      { numFmt: EXCEL_FORMAT.ANGKA_DESIMAL },
      null,
      null,
      null,
      null,
      null,
    ],

    // Mode streaming tidak bisa auto-fit, jadi lebarnya ditetapkan di sini.
    mapRow: (row: any, rowNumber: number) => [
      rowNumber,
      row.nama,
      row.keterangan,
      row.contactperson,
      row.ktp,
      row.alamat,
      row.coa_text,
      row.coagiro_text,
      row.coapiu_text,
      row.coahut_text,
      row.kota,
      row.kodepos,
      row.telp,
      row.email,
      row.fax,
      row.web,
      row.creditterm === null || row.creditterm === undefined
        ? null
        : Number(row.creditterm),
      row.credittermplus === null || row.credittermplus === undefined
        ? null
        : Number(row.credittermplus),
      row.npwp,
      row.alamatfakturpajak,
      row.namapajak,
      row.nominalpph21 === null || row.nominalpph21 === undefined
        ? null
        : Number(row.nominalpph21),
      row.nominalpph23 === null || row.nominalpph23 === undefined
        ? null
        : Number(row.nominalpph23),
      row.noskb,
      row.tglskb,
      row.nosk,
      row.tglsk,
      row.statusaktif_text,
    ],
  };

  /**
   * Merakit workbook Excel dan mengembalikannya sebagai buffer.
   *
   * Hanya untuk export kecil (endpoint GET /supplier/export yang lama):
   * seluruh data ditampung di memori. Export lewat background job memakai
   * ExportJobService yang streaming.
   */
  async buildExcelBuffer(data: any[]): Promise<Buffer> {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:AB1');
    worksheet.mergeCells('A2:AB2');
    worksheet.mergeCells('A3:AB3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN SUPPLIER';
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
      'CONTACTPERSON',
      'KTP',
      'ALAMAT',
      'COA',
      'COAGIRO',
      'COAPIU',
      'COAHUT',
      'KOTA',
      'KODEPOS',
      'TELP',
      'EMAIL',
      'FAX',
      'WEB',
      'CREDITTERM',
      'CREDITTERMPLUS',
      'NPWP',
      'ALAMATFAKTURPAJAK',
      'NAMAPAJAK',
      'NOMINALPPH21',
      'NOMINALPPH23',
      'NOSKB',
      'TGLSKB',
      'NOSK',
      'TGLSK',
      'STATUSAKTIF',
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
        row.ktp,
        row.alamat,
        row.coa_text,
        row.coagiro_text,
        row.coapiu_text,
        row.coahut_text,
        row.kota,
        row.kodepos,
        row.telp,
        row.email,
        row.fax,
        row.web,
        row.creditterm,
        row.credittermplus,
        row.npwp,
        row.alamatfakturpajak,
        row.namapajak,
        row.nominalpph21,
        row.nominalpph23,
        row.noskb,
        row.tglskb,
        row.nosk,
        row.tglsk,
        row.statusaktif_text,
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

    const adjustCols: number[] = [28];
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
      `laporan_supplier_${Date.now()}.xlsx`,
    );
    await fs.promises.writeFile(tempFilePath, buffer);

    return tempFilePath;
  }
}
