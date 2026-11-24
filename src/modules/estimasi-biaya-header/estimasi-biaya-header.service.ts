import * as fs from 'fs';
import * as path from 'path';
import { Column, Workbook } from 'exceljs';
import { LocksService } from '../locks/locks.service';
import { GlobalService } from '../global/global.service';
import { RedisService } from 'src/common/redis/redis.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import {
  withUuidV7,
  formatDateToSQL,
  UtilsService,
} from 'src/utils/utils.service';
import { RunningNumberService } from '../running-number/running-number.service';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { EstimasiBiayaDetailBiayaService } from '../estimasi-biaya-detail-biaya/estimasi-biaya-detail-biaya.service';
import { EstimasiBiayaDetailInvoiceService } from '../estimasi-biaya-detail-invoice/estimasi-biaya-detail-invoice.service';

@Injectable()
export class EstimasiBiayaHeaderService {
  private readonly tableName: string = 'estimasibiayaheader';
  // Tabel untuk TULIS, view untuk BACA — sama seperti bl-header/alatbayar.
  private readonly viewName: string = 'vestimasibiayaheader';
  private readonly detailBiayaTableName: string = 'estimasibiayadetailbiaya';
  // Postgres case-sensitive untuk identifier berkutip: tabelnya
  // 'estimasibiayadetailinvoice' (huruf kecil semua), bukan ...detailInvoice.
  private readonly detailInvoiceTableName: string =
    'estimasibiayadetailinvoice';

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly detailBiayaService: EstimasiBiayaDetailBiayaService,
    private readonly detailInvoiceService: EstimasiBiayaDetailInvoiceService,
  ) {}

  async create(data: any, trx: any) {
    try {
      const created_at = this.utilsService.getTime();
      const updated_at = this.utilsService.getTime();
      const getFormatEstimasiBiayaHeader = await trx('parameter')
        .select('id', 'grp', 'subgrp')
        .where('grp', 'NOMOR ESTIMASI BIAYA')
        .where('kelompok', 'ESTIMASI BIAYA')
        .first();

      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        getFormatEstimasiBiayaHeader.grp,
        getFormatEstimasiBiayaHeader.subgrp,
        this.tableName,
        data.tglbukti,
      );

      const headerData = {
        nobukti: nomorBukti,
        tglbukti: data.tglbukti,
        jenisorder_id: data.jenisorder_id,
        orderan_nobukti: data.orderan_nobukti,
        nominal: this.parseCurrency(data.nominal),
        shipper_id: data.shipper_id,
        statusppn: data.statusppn,
        asuransi_id: data.asuransi_id,
        comodity_id: data.comodity_id ? data.comodity_id : null,
        consignee_id: data.consignee_id ? data.consignee_id : null,
        modifiedby: data.modifiedby,
        created_at,
        updated_at,
      };

      // HANYA tanggal yang dikonversi. Blanket toUpperCase() atas semua
      // string ikut mengenai kolom id/FK yang bertipe text dan
      // case-sensitive (mis. shipper_id 02-019fbb26-... jadi 02-019FBB26-...),
      // sehingga insert melanggar foreign key. BlHeaderService hanya
      // meng-uppercase modifiedby.
      Object.keys(headerData).forEach((key) => {
        if (typeof headerData[key] === 'string') {
          const value = headerData[key];
          const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

          if (dateRegex.test(value)) {
            headerData[key] = formatDateToSQL(value);
          } else if (key === 'modifiedby') {
            headerData[key] = value.toUpperCase();
          }
        }
      });

      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, headerData))
        .returning('*');
      const newItem = insertedItems[0];

      if (data.detailsbiaya && data.detailsbiaya.length > 0) {
        const detailsBiayaPayload = data.detailsbiaya.map((detail: any) => ({
          id: detail.id || 0,
          nobukti: nomorBukti,
          estimasibiaya_id: newItem.id,
          link_id: detail.link_id || null,
          biayaemkl_id: detail.biayaemkl_id || null,
          nominal: this.parseCurrency(detail.nominal),
          nilaiasuransi: this.parseCurrency(detail.nilaiasuransi),
          nominaldisc: this.parseCurrency(detail.nominaldisc),
          nominalsebelumdisc: this.parseCurrency(detail.nominalsebelumdisc),
          nominaltradoluar: this.parseCurrency(detail.nominaltradoluar),
          modifiedby: newItem.modifiedby,
        }));

        await this.detailBiayaService.create(
          detailsBiayaPayload,
          newItem.id,
          trx,
        );
      }

      if (data.detailsinvoice && data.detailsinvoice.length > 0) {
        const detailsInvoicePayload = data.detailsinvoice.map(
          (detail: any) => ({
            id: detail.id || 0,
            nobukti: nomorBukti,
            estimasibiaya_id: newItem.id,
            link_id: detail.link_id || null,
            biayaemkl_id: detail.biayaemkl_id || null,
            nominal: this.parseCurrency(detail.nominal),
            modifiedby: newItem.modifiedby,
          }),
        );
        await this.detailInvoiceService.create(
          detailsInvoicePayload,
          newItem.id,
          trx,
        );
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD ESTIMASI BIAYA HEADER`,
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      const { pageNumber, dataIndex } = await this.resolveGridPosition(
        trx,
        newItem.id,
        data,
      );

      return {
        newItem,
        pageNumber,
        dataIndex,
      };
    } catch (error) {
      console.error(
        'Error process approval creating estimasi biaya header in service:',
        error.message,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process approval creating estimasi biaya header in service',
      );
    }
  }

  async findAll(
    { search, filters, pagination, sort, isLookUp }: FindAllParams,
    trx: any,
  ) {
    try {
      let filtersJenisOrderan;
      let { page, limit } = pagination ?? {};
      page = page ?? 1;
      limit = limit ?? 0;

      const query = trx
        .from(trx.raw(`${this.viewName} as u`))
        .select([
          'u.id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.jenisorder_id',
          'u.orderan_nobukti',
          'u.nominal',
          'u.shipper_id',
          'u.statusppn',
          'u.asuransi_id',
          'u.comodity_id',
          'u.consignee_id',
          'u.modifiedby',
          trx.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),

          'u.jenisorder_nama',
          'u.shipper_nama',
          'u.statusppn_nama',
          'u.statusppn_memo',
          'u.asuransi_nama',
          'u.comodity_nama',
          'u.consignee_nama',
        ]);

      query.modify((qb: any) => this.applyDateRange(qb, filters));
      query.modify((qb: any) => this.applyFilters(qb, filters, search));

      // customOffset: offset absolut dari grid saat window pagination harus
      // mulai di halaman logis mana pun, bukan kelipatan WINDOW_SIZE.
      const customOffset = (pagination as any)?.customOffset;

      if (limit > 0) {
        const offset =
          typeof customOffset === 'number' && customOffset >= 0
            ? customOffset
            : (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      this.applySort(query, sort?.sortBy, sort?.sortDirection);
      // Tiebreaker WAJIB: tiap halaman diambil lewat query LIMIT/OFFSET
      // terpisah, dan ORDER BY yang nilainya seri (mis. sort STATUS AKTIF yang
      // cuma punya 2 nilai) tak dijamin stabil antar query → satu baris bisa
      // muncul di dua halaman ("two children with the same key" di grid).
      query.orderBy('u.id', 'asc');

      // Count HARUS memakai filter & rentang tanggal yang sama dengan query
      // data (pola bl-header). Kalau menghitung seluruh tabel, grid mengira
      // halamannya jauh lebih banyak dari yang ada, lalu terus menarik halaman
      // kosong dan window pagination tidak pernah selesai bergeser.
      const countResult = await trx(`${this.viewName} as u`)
        .count('u.id as total')
        .modify((qb: any) => this.applyDateRange(qb, filters))
        .modify((qb: any) => this.applyFilters(qb, filters, search))
        .first();
      const total = Number(countResult?.total ?? 0);
      const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
      const data = await query;
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
      console.error('Error to findAll Biaya Extra Header', error);
      throw new Error(error);
    }
  }

  // Kolom numerik di Postgres tidak menerima teks berformat ribuan
  // ("2,312,321.00") maupun string kosong. Pola yang sama dipakai
  // KasGantungHeaderService, JurnalUmumHeaderService dan PindahBukuService.
  private parseCurrency(value: any): number {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const cleanValue = value.replace(/[^0-9.-]/g, '');
      const parsed = parseFloat(cleanValue);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  // Kolom turunan di view dicari lewat nama hasil join-nya, bukan id-nya.
  private readonly SEARCH_ALIAS: Record<string, string> = {
    jenisorder_text: 'u.jenisorder_nama',
    shipper_text: 'u.shipper_nama',
    asuransi_text: 'u.asuransi_nama',
    comodity_text: 'u.comodity_nama',
    consignee_text: 'u.consignee_nama',
  };

  private applyDateRange(
    qb: any,
    filters: Record<string, any> | undefined,
  ): void {
    if (!filters?.tglDari || !filters?.tglSampai) return;

    qb.whereBetween('u.tglbukti', [
      formatDateToSQL(String(filters.tglDari)),
      formatDateToSQL(String(filters.tglSampai)),
    ]);
  }

  private applyFilters(
    qb: any,
    filters: Record<string, any> | undefined,
    search?: string,
  ): void {
    const excludeSearchKeys = ['tglDari', 'tglSampai', 'statusppn_text'];
    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );

    if (search) {
      const sanitized = String(search).trim();
      qb.where((query: any) => {
        searchFields.forEach((field) => {
          const alias = this.SEARCH_ALIAS[field];
          if (alias) {
            query.orWhere(alias, 'ilike', `%${sanitized}%`);
          } else if (field === 'tglbukti') {
            query.orWhereRaw(`TO_CHAR(u.${field}, 'DD-MM-YYYY') LIKE ?`, [
              `%${sanitized}%`,
            ]);
          } else if (field === 'created_at' || field === 'updated_at') {
            query.orWhereRaw(
              `TO_CHAR(u.${field}, 'DD-MM-YYYY HH24:MI:SS') LIKE ?`,
              [`%${sanitized}%`],
            );
          } else {
            // Kolom non-teks (u.nominal = numeric) menolak ilike dan
            // menggagalkan SELURUH pencarian, bukan cuma kolom itu.
            query.orWhereRaw('u.??::text ilike ?', [field, `%${sanitized}%`]);
          }
        });
      });
    }

    Object.entries(filters || {}).forEach(([key, value]) => {
      if (key === 'tglDari' || key === 'tglSampai') return;
      if (!value) return;

      const sanitizedValue = String(value);
      const alias = this.SEARCH_ALIAS[key];

      if (key === 'created_at' || key === 'updated_at') {
        qb.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else if (key === 'tglbukti') {
        qb.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY') LIKE ?", [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else if (key === 'statusppn_text') {
        qb.andWhere('u.statusppn', '=', sanitizedValue);
      } else if (alias) {
        qb.andWhere(alias, 'ilike', `%${sanitizedValue}%`);
      } else {
        qb.andWhereRaw('u.??::text ilike ?', [key, `%${sanitizedValue}%`]);
      }
    });
  }

  private resolveSortColumn(sortBy: string): string {
    // Harus sejalan dengan applySort(): kolom relasi diurutkan lewat nama.
    const alias = this.SEARCH_ALIAS[sortBy];
    if (alias) return alias;

    // applySort mengurutkan statusppn_text lewat isi MEMO (JSON). Untuk
    // hitung posisi dipakai nama statusnya — teks yang sama dengan yang
    // dilihat pemakai, dan bisa dibandingkan dengan >= / <=.
    if (sortBy === 'statusppn_text') return 'u.statusppn_nama';

    // Fallback wajib: create/update memanggil ini dengan payload yang
    // kadang tidak membawa sortBy, dan `u.undefined` bikin query gagal.
    return `u.${sortBy || 'nobukti'}`;
  }

  /**
   * Posisi 1-based baris `id` pada urutan grid — dihitung lewat COUNT,
   * bukan dengan menarik seluruh baris hasil filter ke memori lalu
   * findIndex.
   */
  private async resolvePosition(
    trx: any,
    id: string,
    filters: Record<string, any> | undefined,
    search: string | undefined,
    sortBy: string,
    sortDirection: string,
  ): Promise<number> {
    const orderCol = this.resolveSortColumn(sortBy);
    const dir = sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';

    const existingData = await trx(`${this.viewName} as u`)
      .select({ posval: orderCol })
      .where('u.id', id)
      .modify((qb: any) => this.applyDateRange(qb, filters))
      .modify((qb: any) => this.applyFilters(qb, filters, search))
      .first();
    if (!existingData || existingData.posval === null) return 1;

    const resultposition = await trx(`${this.viewName} as u`)
      .count('* as posisi')
      .where(orderCol, dir === 'desc' ? '>=' : '<=', existingData.posval)
      .modify((qb: any) => this.applyDateRange(qb, filters))
      .modify((qb: any) => this.applyFilters(qb, filters, search))
      .first();

    const posisi = Number(resultposition?.posisi ?? 0);
    return posisi > 0 ? posisi : 1;
  }

  /**
   * Halaman + index baris hasil simpan, untuk memposisikan ulang kursor
   * grid. `dataIndex` adalah index ABSOLUT 0-based di seluruh daftar
   * terfilter — kontrak yang sama dengan GridEstimasiBiayaHeader.
   *
   * Kegagalan di sini TIDAK boleh menggagalkan simpan yang sudah berhasil —
   * ini cuma soal posisi kursor.
   */
  private async resolveGridPosition(
    trx: any,
    id: string,
    data: any,
  ): Promise<{ pageNumber: number; dataIndex: number }> {
    const limit = Number(data?.limit) > 0 ? Number(data.limit) : 50;
    try {
      const posisi = await this.resolvePosition(
        trx,
        id,
        data?.filters,
        data?.search,
        data?.sortBy,
        data?.sortDirection,
      );

      return {
        pageNumber: Math.ceil(posisi / limit),
        dataIndex: posisi - 1,
      };
    } catch (error) {
      console.error(
        `Simpan estimasi biaya header ${id} berhasil, tetapi posisi grid pasca-simpan gagal dihitung:`,
        error?.message,
      );
      return { pageNumber: 1, dataIndex: 0 };
    }
  }

  private applySort(query: any, sortBy?: string, sortDirection?: string): void {
    if (!sortBy) return;
    const dir = sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';

    if (sortBy === 'statusppn_text') {
      // memo status PPN disimpan sebagai JSON; urutkan lewat isi MEMO-nya.
      const memoExpr =
        '(CASE WHEN u.statusppn_memo IS JSON THEN u.statusppn_memo::jsonb END)';
      query.orderByRaw(`JSON_VALUE(${memoExpr}, '$.MEMO') ${dir}`);
      return;
    }

    const alias = this.SEARCH_ALIAS[sortBy];
    query.orderBy(alias ?? sortBy, dir);
  }

  private readonly EXPORT_COLUMNS = [
    'u.nobukti',
    'u.orderan_nobukti',
    'u.jenisorder_nama',
    'u.shipper_nama',
    'u.statusppn_nama',
    'u.asuransi_nama',
    'u.comodity_nama',
    'u.nominal',
    'u.modifiedby',
  ];

  buildExportQuery(
    {
      search,
      filters,
      sort,
    }: Pick<FindAllParams, 'search' | 'filters' | 'sort'>,
    db: any,
  ) {
    const sortBy = sort?.sortBy || 'nobukti';
    const sortDirection =
      sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';

    const query = db(`${this.viewName} as u`)
      .select([
        ...this.EXPORT_COLUMNS,
        db.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
        db.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
        db.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
      ])
      .modify((qb: any) => this.applyDateRange(qb, filters))
      .modify((qb: any) => this.applyFilters(qb, filters, search));

    this.applySort(query, sortBy, sortDirection);
    query.orderBy('u.id', 'asc');

    return query;
  }

  async loadReportData(
    id: string,
    { username, judullaporan }: { username: string; judullaporan?: string },
    db: any,
  ): Promise<Record<string, any[]>> {
    const { data } = await this.findOne(id, db);
    const headerRows = data?.header ?? [];

    if (!headerRows.length) {
      return { data: [], detail: [] };
    }

    const header = headerRows[0];

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const tglcetak =
      `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ` +
      `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    // Header digabung ke SETIAP baris detail biaya: itulah bentuk yang
    // LaporanEstimasiBiaya.mrt harapkan di dataset `data`.
    return {
      data: (data.detailbiaya ?? []).map((item: any) => ({
        ...header,
        header_nominal: header.nominal,
        judullaporan: judullaporan ?? 'PT. TRANSPORINDO AGUNG SEJAHTERA',
        usercetak: username,
        tglcetak,
        judul: 'ESTIMASI BIAYA',
        ...item,
        detailbiaya_nominal: item.nominal,
      })),
      detail: data.detailinvoice ?? [],
    };
  }

  async countExportRows(
    { search, filters }: Pick<FindAllParams, 'search' | 'filters'>,
    db: any,
  ): Promise<number> {
    const result = await db(`${this.viewName} as u`)
      .count('u.id as total')
      .modify((qb: any) => this.applyDateRange(qb, filters))
      .modify((qb: any) => this.applyFilters(qb, filters, search))
      .first();

    return Number(result?.total ?? 0);
  }

  readonly exportSheet = {
    sheetName: 'Data Export',
    titleLines: [
      'PT. TRANSPORINDO AGUNG SEJAHTERA',
      'LAPORAN ESTIMASI BIAYA',
      'Data Export',
    ],
    headers: [
      'NO.',
      'NO BUKTI',
      'TGL BUKTI',
      'NO BUKTI ORDERAN',
      'JENIS ORDERAN',
      'SHIPPER',
      'STATUS PPN',
      'ASURANSI',
      'COMODITY',
      'NOMINAL',
      'MODIFIED BY',
      'CREATED AT',
      'UPDATED AT',
    ],
    columnWidths: [5, 25, 15, 25, 25, 30, 15, 30, 25, 18, 20, 22, 22],
    mapRow: (row: any, rowNumber: number) => [
      rowNumber,
      row.nobukti,
      row.tglbukti,
      row.orderan_nobukti,
      row.jenisorder_nama,
      row.shipper_nama,
      row.statusppn_nama,
      row.asuransi_nama,
      row.comodity_nama,
      row.nominal,
      row.modifiedby,
      row.created_at,
      row.updated_at,
    ],
  };

  async findOne(id: string, trx: any) {
    try {
      const query = trx(`${this.viewName} as u`)
        .select([
          'u.id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.jenisorder_id',
          'u.orderan_nobukti',
          'u.nominal',
          'u.shipper_id',
          'u.statusppn',
          'u.asuransi_id',
          'u.comodity_id',
          'u.consignee_id',
          'u.jenisorder_nama',
          'u.shipper_nama',
          'u.statusppn_nama',
          'u.asuransi_nama',
          'u.comodity_nama',
          'u.consignee_nama',
        ])
        .where('u.id', id);

      const data = await query;

      const findOneDetailBiaya = await this.detailBiayaService.findOne(id, trx);
      const findOneDetailInvoice = await this.detailInvoiceService.findOne(
        id,
        trx,
      );

      const result = {
        header: data,
        detailbiaya: findOneDetailBiaya,
        detailinvoice: findOneDetailInvoice,
      };
      // throw new Error('HAHA')

      return {
        data: result,
      };
    } catch (error) {
      console.error('Error fetching data estimasi biaya header by id:', error);
      throw new Error('Failed to fetch data estimasi biaya header by id');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      let updatedData;
      const updated_at = this.utilsService.getTime();
      const existingData = await trx(this.tableName).where('id', id).first();

      const headerData = {
        nobukti: data.nobukti,
        // tglbukti: data.tglbukti,
        jenisorder_id: data.jenisorder_id,
        orderan_nobukti: data.orderan_nobukti,
        nominal: this.parseCurrency(data.nominal),
        shipper_id: data.shipper_id,
        statusppn: data.statusppn,
        asuransi_id: data.asuransi_id,
        comodity_id: data.comodity_id ? data.comodity_id : null,
        consignee_id: data.consignee_id ? data.consignee_id : null,
        // biayaemkl_id & keterangan TIDAK ada kolomnya di estimasibiayaheader;
        // menyetelnya membuat UPDATE gagal dan hasChanges() selalu true.
        modifiedby: data.modifiedby,
      };

      const hasChanges = this.utilsService.hasChanges(headerData, existingData);
      if (hasChanges) {
        const fixHeaderData = {
          ...headerData,
          tglbukti: data.tglbukti,
          updated_at,
        };

        // Alasan sama seperti di create(): id/FK tidak boleh di-uppercase.
        Object.keys(fixHeaderData).forEach((key) => {
          if (typeof fixHeaderData[key] === 'string') {
            const value = fixHeaderData[key];
            const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

            if (dateRegex.test(value)) {
              fixHeaderData[key] = formatDateToSQL(value);
            } else if (key === 'modifiedby') {
              fixHeaderData[key] = value.toUpperCase();
            }
          }
        });

        const updated = await trx(this.tableName)
          .where('id', id)
          .update(fixHeaderData)
          .returning('*');
        updatedData = updated[0];

        await this.logTrailService.create(
          {
            namatabel: this.tableName,
            postingdari: `EDIT ESTIMASI BIAYA HEADER`,
            idtrans: updatedData.id,
            nobuktitrans: updatedData.id,
            aksi: 'ADD',
            datajson: JSON.stringify([updatedData]),
            modifiedby: updatedData.modifiedby,
          },
          trx,
        );
      }

      if (data.detailsbiaya && data.detailsbiaya.length > 0) {
        const detailsBiayaPayload = data.detailsbiaya.map((detail: any) => ({
          id: detail.id || 0,
          nobukti: updatedData
            ? updatedData.nobukti || data.nobukti
            : existingData.nobukti,
          estimasibiaya_id: updatedData ? updatedData.id : existingData.id,
          link_id: detail.link_id || null,
          biayaemkl_id: detail.biayaemkl_id || null,
          nominal: this.parseCurrency(detail.nominal),
          nilaiasuransi: this.parseCurrency(detail.nilaiasuransi),
          nominaldisc: this.parseCurrency(detail.nominaldisc),
          nominalsebelumdisc: this.parseCurrency(detail.nominalsebelumdisc),
          nominaltradoluar: this.parseCurrency(detail.nominaltradoluar),
          modifiedby: updatedData
            ? updatedData.modifiedby
            : existingData.modifiedby,
        }));

        await this.detailBiayaService.create(detailsBiayaPayload, id, trx);
      }

      if (data.detailsinvoice && data.detailsinvoice.length > 0) {
        const detailsInvoicePayload = data.detailsinvoice.map(
          (detail: any) => ({
            id: detail.id || 0,
            nobukti: updatedData
              ? updatedData.nobukti || data.nobukti
              : existingData.nobukti,
            estimasibiaya_id: updatedData ? updatedData.id : existingData.id,
            link_id: detail.link_id || null,
            biayaemkl_id: detail.biayaemkl_id || null,
            nominal: this.parseCurrency(detail.nominal),
            modifiedby: updatedData
              ? updatedData.modifiedby
              : existingData.modifiedby,
          }),
        );

        await this.detailInvoiceService.create(detailsInvoicePayload, id, trx);
      }

      const { pageNumber, dataIndex } = await this.resolveGridPosition(
        trx,
        String(id),
        data,
      );

      return {
        updatedData,
        pageNumber,
        dataIndex,
      };
    } catch (error) {
      console.error(
        'Error process update estimasi biaya header in service:',
        error.message,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process update estimasi biaya header in service',
      );
    }
  }

  async delete(id: string, trx: any, modifiedby: any) {
    try {
      const checkDataDetailBiaya = await trx(this.detailBiayaTableName)
        .select('id')
        .where('estimasibiaya_id', id);
      if (checkDataDetailBiaya && checkDataDetailBiaya.length > 0) {
        for (const detail of checkDataDetailBiaya) {
          await this.detailBiayaService.delete(detail.id, trx, modifiedby);
        }
      }

      const checkDataDetailInvoice = await trx(this.detailInvoiceTableName)
        .select('id')
        .where('estimasibiaya_id', id);
      if (checkDataDetailInvoice && checkDataDetailInvoice.length > 0) {
        for (const detail of checkDataDetailInvoice) {
          await this.detailInvoiceService.delete(detail.id, trx, modifiedby);
        }
      }

      const deletedData = await this.utilsService.lockAndDestroy(
        id,
        this.tableName,
        'id',
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE ESTIMASI BIAYA HEADER',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby.toUpperCase(),
        },
        trx,
      );

      return { status: 200, message: 'Data deleted successfully', deletedData };
    } catch (error) {
      console.log('Error deleting data:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete data estimasi biaya',
      );
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
        // const validasi = await this.globalService.checkUsed(
        //   'akunpusat',
        //   'type_id',
        //   value,
        //   trx,
        // );
        // return validasi;

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

  async exportToExcel(data: any) {
    const dataHeader = data.header[0];
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:H1');
    worksheet.mergeCells('A2:H2');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN ESTIMASI BIAYA';

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

    worksheet.getCell('B5').value = 'NO BUKTI :';
    worksheet.getCell('B6').value = 'TGL BUKTI :';
    worksheet.getCell('B7').value = 'JENIS ORDER :';
    worksheet.getCell('B8').value = 'NO BUKTI ORDERAN :';
    worksheet.getCell('B9').value = 'NOMINAL :';
    worksheet.getCell('B10').value = 'SHIPPER :';
    worksheet.getCell('B11').value = 'STATUS PPN :';
    worksheet.getCell('B12').value = 'ASURANSI :';
    worksheet.getCell('B13').value = 'COMODITY :';
    worksheet.getCell('B14').value = 'CONSIGNEE :';

    worksheet.getCell('C5').value = dataHeader.nobukti;
    worksheet.getCell('C6').value = dataHeader.tglbukti;
    worksheet.getCell('C7').value = dataHeader.jenisorder_nama;
    worksheet.getCell('C8').value = dataHeader.orderan_nobukti;
    worksheet.getCell('C9').value = dataHeader.nominal;
    worksheet.getCell('C9').numFmt = '#,##0.00'; // format angka dengan ribuan
    worksheet.getCell('C9').alignment = {
      horizontal: 'right',
      vertical: 'middle',
    };
    worksheet.getCell('C10').value = dataHeader.shipper_nama;
    worksheet.getCell('C11').value = dataHeader.statusppn_nama;
    worksheet.getCell('C12').value = dataHeader.asuransi_nama;
    worksheet.getCell('C13').value = dataHeader.comodity_nama;
    worksheet.getCell('C14').value = dataHeader.consignee_nama;

    const headersDetailBiaya = [
      'NO.',
      'BIAYA EMKL',
      'LINK HARGA TRUCKING',
      'NOMINAL',
      'NILAI ASURANSI',
      'NOMINAL DISC',
      'NOMINAL SEBELUM DISC',
      'NOMINAL TRADO LUAR',
    ];

    const headersDetailInvoice = [
      'NO.',
      'BIAYA EMKL',
      'LINK HARGA TRUCKING',
      'NOMINAL',
    ];

    worksheet.getCell('A16').value = 'DETAIL BIAYA';
    worksheet.getCell('A16').font = { bold: true };

    headersDetailBiaya.forEach((header, index) => {
      const cell = worksheet.getCell(17, index + 1);
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

    data.detailbiaya.forEach((row, rowIndex) => {
      const currentRow = rowIndex + 18;
      const rowValues = [
        rowIndex + 1,
        row.biayaemkl_nama || '',
        row.link_nama || '',
        row.nominal || '',
        row.nilaiasuransi || '',
        row.nominaldisc || '',
        row.nominalsebelumdisc || '',
        row.nominaltradoluar || '',
      ];

      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);

        cell.value = value ?? '';
        cell.font = { name: 'Tahoma', size: 10 };
        // cell.alignment = {
        //   horizontal: colIndex === 0 ? 'right' : 'left',
        //   vertical: 'middle',
        // };

        if (colIndex >= 3) {
          cell.value = Number(value);
          cell.numFmt = '#,##0.00'; // format angka dengan ribuan
          cell.alignment = {
            horizontal: 'right',
            vertical: 'middle',
          };
        } else if (colIndex === 0) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }

        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    });

    worksheet.getCell('A21').value = 'DETAIL INVOICE';
    worksheet.getCell('A21').font = { bold: true };

    headersDetailInvoice.forEach((header, index) => {
      const cell = worksheet.getCell(22, index + 1);
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

    data.detailinvoice.forEach((row, rowIndex) => {
      const currentRow = rowIndex + 23;
      const rowValues = [
        rowIndex + 1,
        row.biayaemkl_nama || '',
        row.link_nama || '',
        row.nominal || '',
      ];

      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);
        cell.value = value ?? '';
        cell.font = { name: 'Tahoma', size: 10 };

        if (colIndex >= 3) {
          cell.value = Number(value);
          cell.numFmt = '#,##0.00'; // format angka dengan ribuan
          cell.alignment = {
            horizontal: 'right',
            vertical: 'middle',
          };
        } else if (colIndex === 0) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
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

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_estimasi_biaya_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
}
