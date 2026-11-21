import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Column, Workbook } from 'exceljs';
import { LocksService } from '../locks/locks.service';
import {
  withUuidV7,
  formatDateToSQL,
  tandatanya,
  UtilsService,
  calculateItemIndex,
  getFetchedPages,
} from 'src/utils/utils.service';
import { GlobalService } from '../global/global.service';
import { RedisService } from 'src/common/redis/redis.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { dbMssql } from 'src/common/utils/db';
import { StatuspendukungService } from '../statuspendukung/statuspendukung.service';

function parseNominal(value: any): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const cleanValue = String(value).replace(/[^0-9.-]/g, '');
  if (cleanValue === '' || cleanValue === '-') {
    return null;
  }

  const parsed = parseFloat(cleanValue);
  return isNaN(parsed) ? null : parsed;
}

@Injectable()
export class BookingOrderanMuatanService {
  private readonly tableName: string = 'bookingorderanmuatan';
  // Tabel base untuk TULIS, view untuk BACA (lihat create-vbookingorderan-pg.sql).
  private readonly viewName: string = 'vbookingorderanmuatan';

  // Kolom teks bebas yang memang disimpan huruf besar. Daftar ini dipakai
  // create DAN update supaya keduanya tidak bisa berbeda lagi: dulu update
  // meng-uppercase SEMUA field string, termasuk kolom id relasi. Karena id
  // uuid v7 dibuat huruf kecil (mis. '02-019fbb26-3876-...'), setiap edit
  // mengubahnya jadi huruf besar dan ditolak foreign key:
  //   FK_bookingorderanmuatan_shipper_id_shipper —
  //   Key (shipper_id)=(02-019FBB26-...) is not present in table "shipper".
  // Akibatnya baris apa pun yang menunjuk relasi ber-id huruf kecil TIDAK
  // BISA disimpan ulang sama sekali.
  private readonly kolomHurufBesar: string[] = [
    'nobukti',
    'keterangan',
    'nopolisi',
    'nosp',
    'nocontainer',
    'noseal',
    'asalmuatan',
    'comodity',
    'gandengan',
  ];

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
    private readonly statuspendukungService: StatuspendukungService,
  ) {}

  async create(createData: any, trx: any) {
    try {
      const {
        id,
        jenisOrderan,
        tglDari,
        tglSampai,
        container_nama,
        shipper_nama,
        tujuankapal_nama,
        marketing_nama,
        schedule_nama,
        pelayarancontainer_nama,
        jenismuatan_nama,
        sandarkapal_nama,
        tradoluar,
        tradoluar_nama,
        lokasistuffing_nama,
        emkllain_nama,
        daftarbl_nama,
        pisahbl,
        pisahbl_nama,
        jobptd,
        jobptd_nama,
        transit,
        transit_nama,
        stuffingdepo,
        stuffingdepo_nama,
        opendoor,
        opendoor_nama,
        batalmuat,
        batalmuat_nama,
        soc,
        soc_nama,
        pengurusandoorekspedisilain,
        pengurusandoorekspedisilain_nama,
        kapal,
        kapal_nama,
        voyberangkat,
        tglberangkat,
        hargatrucking,
        hargatrucking_nama,
        estmuat,
        ...insertData
      } = createData;

      this.kolomHurufBesar.forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      insertData.nominalstuffing = parseNominal(insertData.nominalstuffing);

      insertData.updated_at = this.utilsService.getTime();
      insertData.created_at = this.utilsService.getTime();

      const insertedData = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

      const newItem = insertedData[0];

      const dataPendukungMuatan = {
        'TRADO LUAR': tradoluar,
        'PISAH BL': pisahbl,
        'JOB PTD': jobptd,
        TRANSIT: transit,
        'STUFFING DEPO': stuffingdepo,
        'OPEN DOOR': opendoor,
        'BATAL MUAT': batalmuat,
        SOC: soc,
        'PENGURUSAN DOOR EKSPEDISI LAIN': pengurusandoorekspedisilain,
      };

      const createDataStatusPendukung =
        await this.statuspendukungService.create(
          this.tableName,
          newItem.id,
          newItem.modifiedby,
          trx,
          dataPendukungMuatan,
        );

      await this.logTrailService.create(
        {
          namatable2: this.tableName,
          postingdari: 'ADD BOOKING ORDERAN MUATAN',
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      return {
        newItem,
      };
    } catch (error) {
      throw new Error(
        `Error creating booking orderan muatan: ${error.message}`,
      );
    }
  }

  /**
   * Periode & jenis order diturunkan ke vbookingorderanmuatan lewat GUC
   * (`tas.booking_tgldari`, `tas.booking_tglsampai`,
   * `tas.booking_jenisorder_id`), bukan sebagai predikat di query luar: view
   * menyaring bookingorderanheader SEBELUM 12 join referensi, jadi join-join itu
   * hanya kena baris satu periode.
   *
   * Tiap batas berdiri SENDIRI — kalau hanya diisi saat tglDari DAN tglSampai
   * dua-duanya ada, periode separuh terbuka diam-diam berubah jadi "tanpa
   * filter" (pelajaran dari shipping instruction, panjar, dan BL).
   *
   * `set_config(..., true)` hanya hidup selama transaksi, jadi WAJIB dipanggil
   * ulang di setiap transaksi yang membaca view ini.
   */
  private async setSessionContext(
    trx: any,
    filters: Record<string, any> | undefined,
  ): Promise<void> {
    const tglDari = filters?.tglDari
      ? String(formatDateToSQL(String(filters.tglDari)))
      : '';
    const tglSampai = filters?.tglSampai
      ? String(formatDateToSQL(String(filters.tglSampai)))
      : '';
    const jenisOrderId = filters?.jenisOrderan
      ? String(filters.jenisOrderan)
      : '';

    await trx.raw(
      `SELECT set_config('tas.booking_tgldari', ?, true),
              set_config('tas.booking_tglsampai', ?, true),
              set_config('tas.booking_jenisorder_id', ?, true)`,
      [tglDari, tglSampai, jenisOrderId],
    );
  }

  // Kolom pivot status pendukung yang dipakai grid. Dijadikan field kelas
  // supaya findAll dan resolvePosition membaca daftar yang SAMA.
  private readonly fieldTempHasil: string[] = [
    // 'nobukti',
    'tradoluar',
    'tradoluar_nama',
    'tradoluar_memo',
    'pisahbl',
    'pisahbl_nama',
    'pisahbl_memo',
    'jobptd',
    'jobptd_nama',
    'jobptd_memo',
    'transit',
    'transit_nama',
    'transit_memo',
    'stuffingdepo',
    'stuffingdepo_nama',
    'stuffingdepo_memo',
    'opendoor',
    'opendoor_nama',
    'opendoor_memo',
    'batalmuat',
    'batalmuat_nama',
    'batalmuat_memo',
    'soc',
    'soc_nama',
    'soc_memo',
    'pengurusandoor',
    'pengurusandoor_nama',
    'pengurusandoor_memo',
    'approval',
    'approval_nama',
    'approval_memo',
  ];

  /**
   * Dua TEMP TABLE per request (link orderan + pivot status pendukung) lalu
   * query dasar yang sudah menjoin keduanya ke view.
   *
   * Dipakai findAll MAUPUN resolvePosition: keduanya harus membaca himpunan
   * baris yang sama, kalau tidak posisi kursor dihitung dari daftar yang beda
   * dengan yang ditampilkan.
   *
   * Temp table-nya ON COMMIT DROP, jadi hidupnya hanya selama transaksi
   * pemanggil — pemanggil WAJIB sudah menjalankan setSessionContext.
   */
  private async buildQueryDasar(trx: any) {
    const tempUrl = `temp_url_${Math.random().toString(36).substring(2, 8)}`;
    const url = 'orderanmuatan';

    await trx.raw(`
      CREATE TEMP TABLE "${tempUrl}"
      ON COMMIT DROP
      AS
      SELECT
        u.id::text AS id,
        u.orderan_nobukti,
        STRING_AGG(
          '<a target="_blank" className="link-color" href="/dashboard/${url}'
            || ${tandatanya} || 'orderan_nobukti=' || u.orderan_nobukti || '">'
            || '<HighlightWrapper value="' || u.orderan_nobukti || '" />'
            || '</a>', ','
        ) AS link
      FROM bookingorderanheader u
      GROUP BY u.id, u.orderan_nobukti
    `);

    const dataTempStatusPendukung =
      await this.utilsService.tempPivotStatusPendukung(
        trx,
        this.tableName,
        this.fieldTempHasil,
        // Baca dari VIEW, bukan tabel base: view sudah dipangkas periode &
        // jenis order lewat set_config, jadi pivot hanya mengolah baris yang
        // memang akan tampil. Diukur di 100rb baris muatan / 1 juta baris
        // statuspendukung: 14.181 ms -> 1.072 ms.
        this.viewName,
      );

    // DIBUNGKUS objek dengan sengaja. QueryBuilder knex itu thenable, jadi
    // `return builder` dari fungsi async membuat runtime ikut meng-await-nya:
    // query langsung DIEKSEKUSI dan yang dikembalikan array baris, bukan
    // builder ("(intermediate value).select is not a function").
    return {
      query: trx
        .from(trx.raw(`${this.viewName} as u`))
        .leftJoin(
          trx.raw(`"${tempUrl}" as "tempUrl"`),
          'u.orderan_nobukti',
          'tempUrl.orderan_nobukti',
        )
        .leftJoin(`${dataTempStatusPendukung} as pivot`, 'u.id', 'pivot.id'),
    };
  }
  /**
   * Kolom yang ikut ke file Excel. Semuanya sudah ada di view, jadi export
   * tidak perlu menjoin ulang 12 tabel referensi.
   */
  private readonly EXPORT_COLUMNS = [
    'u.nobukti',
    'u.orderan_nobukti',
    'u.jenisorder_nama',
    'u.container_nama',
    'u.shipper_nama',
    'u.tujuankapal_nama',
    'u.marketing_nama',
    'u.keterangan',
    'u.schedule_nama',
    'u.pelayarancontainer_nama',
    'u.jenismuatan_nama',
    'u.sandarkapal_nama',
    'u.nopolisi',
    'u.nosp',
    'u.nocontainer',
    'u.noseal',
    'u.lokasistuffing_nama',
    'u.nominalstuffing',
    'u.emkllain_nama',
    'u.asalmuatan',
    'u.daftarbl_nama',
    'u.comodity',
    'u.gandengan',
    'u.modifiedby',
  ];

  /**
   * Sumber baris untuk pivot status pendukung saat export.
   *
   * Export berjalan di LUAR transaksi (job-nya streaming), jadi dua hal yang
   * dipakai findAll tidak tersedia: temp table `ON COMMIT DROP` dan GUC
   * `set_config(..., true)` yang menyaring view. Karena itu pivotnya dipasang
   * sebagai DERIVED TABLE, dan sumbernya dibatasi periode secara eksplisit —
   * kalau tidak, pivot mengolah SELURUH tabel sebelum di-join.
   */
  private sumberPivotExport(db: any, filters: Record<string, any> | undefined) {
    if (!filters?.tglDari || !filters?.tglSampai) {
      return 'bookingorderanmuatan';
    }
    const dari = formatDateToSQL(String(filters.tglDari));
    const sampai = formatDateToSQL(String(filters.tglSampai));
    return `(
      SELECT m.*
      FROM bookingorderanmuatan m
      INNER JOIN bookingorderanheader h ON m.nobukti = h.nobukti
      WHERE h.tglbukti BETWEEN ${db.raw('?', [dari])} AND ${db.raw('?', [sampai])}
    )`;
  }

  /**
   * Periode dipasang sebagai predikat biasa, BUKAN lewat session context:
   * export tidak punya transaksi tempat `set_config(..., true)` bisa hidup.
   */
  private applyDateRange(
    qb: any,
    filters: Record<string, any> | undefined,
  ): void {
    if (!filters?.tglDari || !filters?.tglSampai) return;

    qb.whereBetween('u.header_tglbukti', [
      formatDateToSQL(String(filters.tglDari)),
      formatDateToSQL(String(filters.tglSampai)),
    ]);
  }

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

    const pivotSelect = this.utilsService.buildStatusPendukungSelect(
      this.tableName,
      this.fieldTempHasil,
      this.sumberPivotExport(db, filters),
    );

    const query = db(`${this.viewName} as u`)
      .select([
        ...this.EXPORT_COLUMNS,
        db.raw("TO_CHAR(u.header_tglbukti, 'DD-MM-YYYY') as tglbukti"),
        db.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
        db.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
        'pivot.tradoluar_nama',
        'pivot.pisahbl_nama',
        'pivot.jobptd_nama',
        'pivot.transit_nama',
        'pivot.stuffingdepo_nama',
        'pivot.opendoor_nama',
        'pivot.batalmuat_nama',
        'pivot.soc_nama',
        'pivot.pengurusandoor_nama',
        'pivot.approval_nama',
      ])
      // Alias `pivot` sengaja sama dengan yang dipakai findAll, supaya
      // applyFilters yang SAMA bisa dipakai di sini tanpa cabang khusus.
      .leftJoin(db.raw(`(${pivotSelect}) as pivot`), 'u.id', 'pivot.id')
      .modify((qb: any) => this.applyDateRange(qb, filters))
      .modify((qb: any) => this.applyFilters(qb, filters, search));

    const { orderCol } = this.resolvePositionOrder(sortBy, sortDirection);
    query.orderBy(db.raw(orderCol), sortDirection);

    return query;
  }

  async countExportRows(
    { search, filters }: Pick<FindAllParams, 'search' | 'filters'>,
    db: any,
  ): Promise<number> {
    const pivotSelect = this.utilsService.buildStatusPendukungSelect(
      this.tableName,
      this.fieldTempHasil,
      this.sumberPivotExport(db, filters),
    );

    const result = await db(`${this.viewName} as u`)
      .count('u.id as total')
      .leftJoin(db.raw(`(${pivotSelect}) as pivot`), 'u.id', 'pivot.id')
      .modify((qb: any) => this.applyDateRange(qb, filters))
      .modify((qb: any) => this.applyFilters(qb, filters, search))
      .first();

    return Number(result?.total ?? 0);
  }

  readonly exportSheet = {
    sheetName: 'Data Export',
    titleLines: [
      'PT. TRANSPORINDO AGUNG SEJAHTERA',
      'LAPORAN BOOKING ORDERAN MUATAN',
      'Data Export',
    ],
    headers: [
      'NO.',
      'NO BUKTI',
      'NO BUKTI ORDERAN',
      'TGL BUKTI',
      'JENIS ORDERAN',
      'CONTAINER',
      'SHIPPER',
      'TUJUAN KAPAL',
      'MARKETING',
      'KETERANGAN',
      'SCHEDULE',
      'CONTAINER PELAYARAN',
      'JENIS MUATAN',
      'SANDAR KAPAL',
      'NO POLISI',
      'NO SP',
      'NO CONTAINER',
      'NO SEAL',
      'LOKASI STUFFING',
      'NOMINAL STUFFING',
      'EMKL LAIN',
      'ASAL MUATAN',
      'DAFTAR BL',
      'COMODITY',
      'GANDENGAN',
      'STATUS TRADO LUAR',
      'STATUS PISAH BL',
      'STATUS JOB PTD',
      'STATUS TRANSIT',
      'STATUS STUFFING DEPO',
      'STATUS OPEN DOOR',
      'STATUS BATAL MUAT',
      'STATUS SOC',
      'STATUS PENGURUSAN DOOR',
      'STATUS APPROVAL',
      'MODIFIED BY',
      'CREATED AT',
      'UPDATED AT',
    ],
    columnWidths: [
      5, 25, 25, 15, 18, 20, 20, 22, 18, 30, 20, 22, 20, 20, 18, 18, 20, 18, 25,
      18, 20, 25, 20, 25, 18, 18, 18, 18, 18, 20, 18, 18, 14, 22, 18, 20, 22,
      22,
    ],
    mapRow: (row: any, rowNumber: number) => [
      rowNumber,
      row.nobukti,
      row.orderan_nobukti,
      row.tglbukti,
      row.jenisorder_nama,
      row.container_nama,
      row.shipper_nama,
      row.tujuankapal_nama,
      row.marketing_nama,
      row.keterangan,
      row.schedule_nama,
      row.pelayarancontainer_nama,
      row.jenismuatan_nama,
      row.sandarkapal_nama,
      row.nopolisi,
      row.nosp,
      row.nocontainer,
      row.noseal,
      row.lokasistuffing_nama,
      row.nominalstuffing,
      row.emkllain_nama,
      row.asalmuatan,
      row.daftarbl_nama,
      row.comodity,
      row.gandengan,
      row.tradoluar_nama,
      row.pisahbl_nama,
      row.jobptd_nama,
      row.transit_nama,
      row.stuffingdepo_nama,
      row.opendoor_nama,
      row.batalmuat_nama,
      row.soc_nama,
      row.pengurusandoor_nama,
      row.approval_nama,
      row.modifiedby,
      row.created_at,
      row.updated_at,
    ],
  };

  /**
   * Kolom yang dipakai sebagai acuan URUTAN saat menghitung posisi baris.
   * Kolom lookup diurutkan lewat kolom `_nama`-nya, bukan id uuid-nya —
   * mengurutkan uuid menghasilkan urutan yang tidak sama dengan yang dilihat
   * user di grid, sehingga posisinya meleset.
   */
  private resolvePositionOrder(
    sortBy: string,
    sortDirection: string,
  ): { orderCol: string; dir: 'asc' | 'desc' } {
    const dir = sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
    const peta: Record<string, string> = {
      jenisorder_text: 'u.jenisorder_nama',
      container_text: 'u.container_nama',
      shipper_text: 'u.shipper_nama',
      tujuankapal_text: 'u.tujuankapal_nama',
      marketing_text: 'u.marketing_nama',
      schedule_text: 'u.schedule_nama',
      pelayarancontainer_text: 'u.pelayarancontainer_nama',
      jenismuatan_text: 'u.jenismuatan_nama',
      sandarkapal_text: 'u.sandarkapal_nama',
      lokasistuffing_text: 'u.lokasistuffing_nama',
      emkllain_text: 'u.emkllain_nama',
      daftarbl_text: 'u.daftarbl_nama',
      statustradoluar: 'pivot.tradoluar_nama',
      statuspisahbl: 'pivot.pisahbl_nama',
      statusjobptd: 'pivot.jobptd_nama',
      statustransit: 'pivot.transit_nama',
      statusstuffingdepo: 'pivot.stuffingdepo_nama',
      statusopendoor: 'pivot.opendoor_nama',
      statusbatalmuat: 'pivot.batalmuat_nama',
      statussoc: 'pivot.soc_nama',
      statuspengurusandoor: 'pivot.pengurusandoor_nama',
      statusapproval: 'pivot.approval_nama',
    };
    return { orderCol: peta[sortBy] ?? `u.${sortBy}`, dir };
  }

  /**
   * Posisi 1-based baris `id` pada urutan grid — dihitung lewat COUNT, bukan
   * dengan menarik seluruh baris hasil filter ke memori lalu findIndex.
   *
   * Versi lama modul ini memakai `findAll({ limit: 0 })` lalu
   * `data.findIndex(...)`: seluruh daftar terfilter ditarik ke memori setiap
   * kali simpan, dan `pageNumber`-nya diambil dari `pagination.currentPage`
   * yang isinya halaman yang SEDANG dibuka grid — bukan halaman tempat baris
   * hasil simpan berada. Itulah sebabnya kursor melompat ke atas.
   *
   * Pemanggil WAJIB sudah memanggil setSessionContext di transaksi yang sama,
   * karena hitungan ini membaca view.
   */
  private async resolvePosition(
    trx: any,
    id: string,
    filters: Record<string, any> | undefined,
    search: string | undefined,
    sortBy: string,
    sortDirection: string,
  ): Promise<number> {
    const { orderCol, dir } = this.resolvePositionOrder(sortBy, sortDirection);
    const { query: dasar } = await this.buildQueryDasar(trx);

    const existingData = await dasar
      .clone()
      .select({ posval: trx.raw(orderCol) })
      .where('u.id', id)
      .modify((qb: any) => this.applyFilters(qb, filters, search))
      .first();

    // Baris tidak lolos filter aktif (mis. habis diedit jadi tidak cocok) ->
    // jatuhkan fokus ke baris pertama daripada menghitung posisi yang salah.
    if (!existingData || existingData.posval === null) return 1;

    const resultposition = await dasar
      .clone()
      .count('* as posisi')
      .where(
        trx.raw(orderCol),
        dir === 'desc' ? '>=' : '<=',
        existingData.posval,
      )
      .modify((qb: any) => this.applyFilters(qb, filters, search))
      .first();

    const posisi = Number(resultposition?.posisi ?? 0);
    return posisi > 0 ? posisi : 1;
  }

  /**
   * Halaman + index baris hasil simpan, untuk memposisikan ulang kursor grid.
   *
   * `itemIndex` adalah index DI DALAM window yang dimuat, bukan index global:
   * grid menghitung barisnya relatif terhadap halaman pertama window, jadi
   * mengirim index global membuat baris ter-highlight melompat sejauh satu
   * halaman ekstra untuk setiap halaman setelah yang pertama.
   */
  private async buildPagedResult(
    trx: any,
    posisi: number,
    totalItems: number,
    limit: number,
    sortBy: string,
    sortDirection: string,
    filters: Record<string, any> | undefined,
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
      } as any,
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

  /**
   * Posisi grid untuk satu id, lengkap dengan window datanya.
   *
   * Kegagalan di sini TIDAK boleh menggagalkan simpan/approval yang sudah
   * berhasil — ini cuma soal posisi kursor, jadi jatuhkan ke baris pertama.
   */
  async resolveGridPosition(trx: any, id: string, data: any) {
    try {
      const sortBy = data?.sortBy || 'nobukti';
      const sortDirection =
        String(data?.sortDirection).toLowerCase() === 'desc' ? 'desc' : 'asc';
      const limit = Number(data?.limit) > 0 ? Number(data.limit) : 50;
      const search = data?.search ?? '';
      const filters = data?.filters ?? {};

      await this.setSessionContext(trx, filters);

      const hitung: any = await this.findAll(
        {
          search,
          filters,
          pagination: { page: 1, limit: 1 },
          sort: { sortBy, sortDirection },
          isLookUp: false,
        } as any,
        trx,
      );
      const totalItems = Number(hitung?.total ?? 0);

      const posisi = await this.resolvePosition(
        trx,
        id,
        filters,
        search,
        sortBy,
        sortDirection,
      );

      return await this.buildPagedResult(
        trx,
        posisi,
        totalItems,
        limit,
        sortBy,
        sortDirection,
        filters,
        search,
      );
    } catch (error) {
      console.error('Gagal menghitung posisi grid:', error);
      return { itemIndex: 0, pageNumber: 1, fetchedPages: [1], pagedData: {} };
    }
  }

  /**
   * Predikat periode + search + filter kolom. SATU tempat, dipakai findAll
   * MAUPUN resolvePosition — kalau keduanya menyalin blok ini masing-masing,
   * posisi kursor pasca-simpan bisa dihitung dari himpunan baris yang berbeda
   * dengan yang ditampilkan grid.
   *
   * Mengharapkan query yang sudah menjoin alias `u` (view), `tempUrl`, dan
   * `pivot` — lihat buildQueryDasar.
   */
  private applyFilters(
    query: any,
    filters: Record<string, any> | undefined,
    search: string | undefined,
  ) {
    if (filters?.tglDari && filters?.tglSampai) {
      const tglDariFormatted = formatDateToSQL(String(filters?.tglDari));
      const tglSampaiFormatted = formatDateToSQL(String(filters?.tglSampai));

      query.whereBetween('u.header_tglbukti', [
        tglDariFormatted,
        tglSampaiFormatted,
      ]);
    }

    if (search) {
      const sanitizedValue = String(search).replace(/\[/g, '[[]');
      query.where((builder) => {
        builder
          .orWhere('u.nobukti', 'like', `%${sanitizedValue}%`)
          .orWhere('u.keterangan', 'like', `%${sanitizedValue}%`)
          .orWhere('u.nopolisi', 'like', `%${sanitizedValue}%`)
          .orWhere('u.nosp', 'like', `%${sanitizedValue}%`)
          .orWhere('u.nocontainer', 'like', `%${sanitizedValue}%`)
          .orWhere('u.noseal', 'like', `%${sanitizedValue}%`)
          // nominalstuffing bertipe numeric; `LIKE` langsung ditolak
          // Postgres (operator does not exist: numeric ~~ unknown) dan
          // menggagalkan SELURUH pencarian di modul ini. Pola `??::text like ?`
          // sama dengan yang dipakai panjarmuatandetail & pengeluarandetail.
          .orWhereRaw('u.??::text like ?', [
            'nominalstuffing',
            `%${sanitizedValue}%`,
          ])
          .orWhere('u.asalmuatan', 'like', `%${sanitizedValue}%`)
          .orWhere('u.comodity', 'like', `%${sanitizedValue}%`)
          .orWhere('u.gandengan', 'like', `%${sanitizedValue}%`)
          .orWhere('u.modifiedby', 'like', `%${sanitizedValue}%`)
          .orWhereRaw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
            `%${sanitizedValue}%`,
          ])
          .orWhereRaw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
            `%${sanitizedValue}%`,
          ])
          .orWhereRaw("TO_CHAR(u.header_tglbukti, 'DD-MM-YYYY') LIKE ?", [
            `%${sanitizedValue}%`,
          ])
          .orWhere('u.orderan_nobukti', 'like', `%${sanitizedValue}%`)
          .orWhere('u.container_nama', 'like', `%${sanitizedValue}%`)
          .orWhere('u.shipper_nama', 'like', `%${sanitizedValue}%`)
          .orWhere('u.tujuankapal_nama', 'like', `%${sanitizedValue}%`)
          .orWhere('u.marketing_nama', 'like', `%${sanitizedValue}%`)
          .orWhere('u.schedule_nama', 'like', `%${sanitizedValue}%`)
          .orWhere('u.pelayarancontainer_nama', 'like', `%${sanitizedValue}%`)
          .orWhere('u.jenismuatan_nama', 'like', `%${sanitizedValue}%`)
          .orWhere('u.sandarkapal_nama', 'like', `%${sanitizedValue}%`)
          .orWhere('u.lokasistuffing_nama', 'like', `%${sanitizedValue}%`)
          .orWhere('u.emkllain_nama', 'like', `%${sanitizedValue}%`)
          .orWhere('u.daftarbl_nama', 'like', `%${sanitizedValue}%`)
          .orWhere('u.marketing_nama', 'like', `%${sanitizedValue}%`);
      });
    }

    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        const sanitizedValue = String(value).replace(/\[/g, '[[]');

        if (
          key === 'tglDari' ||
          key === 'tglSampai' ||
          key === 'jenisOrderan'
        ) {
          continue; // Lewati filter jika key adalah 'tglDari' atau 'tglSampai'
        }

        if (value) {
          if (key === 'created_at' || key === 'updated_at') {
            query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
              key,
              `%${sanitizedValue}%`,
            ]);
          } else if (key === 'tglbukti') {
            query.andWhereRaw("TO_CHAR(header.??, 'DD-MM-YYYY') LIKE ?", [
              key,
              `%${sanitizedValue}%`,
            ]);
          } else if (key === 'orderan_nobukti') {
            query.andWhere('u.orderan_nobukti', 'like', `%${sanitizedValue}%`);
          } else if (key === 'jenisorder_text') {
            query.andWhere('u.jenisorder_nama', 'like', `%${sanitizedValue}%`);
          } else if (key === 'container_text') {
            query.andWhere('u.container_nama', 'like', `%${sanitizedValue}%`);
          } else if (key === 'shipper_text') {
            query.andWhere('u.shipper_nama', 'like', `%${sanitizedValue}%`);
          } else if (key === 'tujuankapal_text') {
            query.andWhere('u.tujuankapal_nama', 'like', `%${sanitizedValue}%`);
          } else if (key === 'marketing_text') {
            query.andWhere('u.marketing_nama', 'like', `%${sanitizedValue}%`);
          } else if (key === 'schedule_text') {
            query.andWhere('u.schedule_nama', 'like', `%${sanitizedValue}%`);
          } else if (key === 'pelayarancontainer_text') {
            query.andWhere(
              'u.pelayarancontainer_nama',
              'like',
              `%${sanitizedValue}%`,
            );
          } else if (key === 'jenismuatan_text') {
            query.andWhere('u.jenismuatan_nama', 'like', `%${sanitizedValue}%`);
          } else if (key === 'sandarkapal_text') {
            query.andWhere('u.sandarkapal_nama', 'like', `%${sanitizedValue}%`);
          } else if (key === 'lokasistuffing_text') {
            query.andWhere(
              'u.lokasistuffing_nama',
              'like',
              `%${sanitizedValue}%`,
            );
          } else if (key === 'emkllain_text') {
            query.andWhere('u.emkllain_nama', 'like', `%${sanitizedValue}%`);
          } else if (key === 'daftarbl_text') {
            query.andWhere('u.daftarbl_nama', 'like', `%${sanitizedValue}%`);
          } else if (key === 'tradoluar_text') {
            query.andWhere('pivot.tradoluar', '=', sanitizedValue);
          } else if (key === 'pisahbl_text') {
            query.andWhere('pivot.pisahbl', '=', sanitizedValue);
          } else if (key === 'jobptd_text') {
            query.andWhere('pivot.jobptd', '=', sanitizedValue);
          } else if (key === 'transit_text') {
            query.andWhere('pivot.transit', '=', sanitizedValue);
          } else if (key === 'stuffingdepo_text') {
            query.andWhere('pivot.stuffingdepo', '=', sanitizedValue);
          } else if (key === 'opendoor_text') {
            query.andWhere('pivot.opendoor', '=', sanitizedValue);
          } else if (key === 'batalmuat_text') {
            query.andWhere('pivot.batalmuat', '=', sanitizedValue);
          } else if (key === 'soc_text') {
            query.andWhere('pivot.soc', '=', sanitizedValue);
          } else if (key === 'pengurusandoor_text') {
            query.andWhere('pivot.pengurusandoor', '=', sanitizedValue);
          } else if (key === 'approval_text') {
            query.andWhere('pivot.approval', '=', sanitizedValue);
          } else {
            query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
          }
        }
      }
    }
  }

  async findAll(
    { search, filters, pagination, sort, isLookUp }: FindAllParams,
    trx: any,
  ) {
    try {
      let { page, limit } = pagination ?? {};
      page = page ?? 1;
      limit = limit ?? 0;

      await this.setSessionContext(trx, filters);

      // Temp table + join disiapkan helper bersama supaya findAll dan
      // resolvePosition tidak bisa menyimpang satu sama lain.
      const { query: queryDasar } = await this.buildQueryDasar(trx);
      const query = queryDasar.select([
        'u.id as id',
        'u.bookingorderan_id',
        'u.nobukti',
        'u.container_id',
        'u.shipper_id',
        'u.tujuankapal_id',
        'u.marketing_id',
        'u.keterangan',
        'u.schedule_id',
        'u.pelayarancontainer_id',
        'u.jenismuatan_id',
        'u.sandarkapal_id',
        'u.nopolisi',
        'u.nosp',
        'u.nocontainer',
        'u.noseal',
        'u.lokasistuffing',
        'u.nominalstuffing',
        'u.emkl_id',
        'u.asalmuatan',
        'u.daftarbl_id',
        'u.comodity',
        'u.gandengan',
        'u.modifiedby',
        trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
        trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),

        'u.header_id',
        'u.header_nobukti',
        trx.raw("TO_CHAR(u.header_tglbukti, 'DD-MM-YYYY') as tglbukti"),
        'u.jenisorder_id',
        'u.jenisorder_nama',
        'u.statusformat',
        'u.orderan_nobukti',
        'tempUrl.link',

        'u.container_nama',
        'u.shipper_nama',
        'u.tujuankapal_nama',
        'u.marketing_nama',
        'u.schedule_nama',
        'u.pelayarancontainer_nama',
        'u.jenismuatan_nama',
        'u.sandarkapal_nama',
        'u.lokasistuffing_nama',
        'u.emkllain_nama',
        'u.daftarbl_nama',

        // `pivot.nobukti` sengaja TIDAK di-select: nilainya sama dengan
        // u.nobukti yang sudah ada di atas, dan kehadirannya membuat
        // `ORDER BY nobukti` (sortBy default dari grid, tanpa prefiks) ditolak
        // Postgres — "ORDER BY nobukti is ambiguous".
        'pivot.tradoluar as tradoluar',
        'pivot.tradoluar_nama as tradoluar_nama',
        'pivot.tradoluar_memo as tradoluar_memo',
        'pivot.pisahbl as pisahbl',
        'pivot.pisahbl_nama as pisahbl_nama',
        'pivot.pisahbl_memo as pisahbl_memo',
        'pivot.jobptd as jobptd',
        'pivot.jobptd_nama as jobptd_nama',
        'pivot.jobptd_memo as jobptd_memo',
        'pivot.transit as transit',
        'pivot.transit_nama as transit_nama',
        'pivot.transit_memo as transit_memo',
        'pivot.stuffingdepo as stuffingdepo',
        'pivot.stuffingdepo_nama as stuffingdepo_nama',
        'pivot.stuffingdepo_memo as stuffingdepo_memo',
        'pivot.opendoor as opendoor',
        'pivot.opendoor_nama as opendoor_nama',
        'pivot.opendoor_memo as opendoor_memo',
        'pivot.batalmuat as batalmuat',
        'pivot.batalmuat_nama as batalmuat_nama',
        'pivot.batalmuat_memo as batalmuat_memo',
        'pivot.soc as soc',
        'pivot.soc_nama as soc_nama',
        'pivot.soc_memo as soc_memo',
        'pivot.pengurusandoor as pengurusandoor',
        'pivot.pengurusandoor_nama as pengurusandoor_nama',
        'pivot.pengurusandoor_memo as pengurusandoor_memo',
        'pivot.approval as approval',
        'pivot.approval_nama as approval_nama',
        'pivot.approval_memo as approval_memo',
      ]);

      this.applyFilters(query, filters, search);

      // COUNT harus memakai filter & search yang SAMA dengan query data.
      // Versi lama memanggil `trx(this.tableName).count('id as total')` — tanpa
      // filter sama sekali, jadi:
      //   1. full scan seluruh bookingorderanmuatan di SETIAP request, dan
      //   2. totalPages dihitung dari jumlah SELURUH tabel, bukan hasil filter,
      //      sehingga grid berjendela terus meminta halaman yang datanya kosong.
      // Ini bug yang sama dengan yang dulu ditemukan di biayaextraheader.
      //
      // clone() dipakai (bukan menyalin ulang blok filter) supaya predikatnya
      // dijamin identik: begitu salah satu filter di atas diubah, count ikut
      // berubah dengan sendirinya. clearSelect/clearOrder wajib — ORDER BY atas
      // kolom yang tidak di-select ditolak Postgres pada query beragregasi.
      //
      // Clone-nya diambil DI SINI, sebelum limit/offset dipasang: clone()
      // menyalin limit & offset juga, sehingga `SELECT count(*) ... LIMIT 50
      // OFFSET 50` membuang satu-satunya baris hasil count dan total jadi 0 di
      // setiap halaman selain halaman pertama.
      const countQuery = query.clone().clearSelect().clearOrder();
      if (limit > 0) {
        // customOffset: offset absolut dari grid berjendela, dipakai saat window
        // harus mulai di halaman yang BUKAN kelipatan ukuran window (mis.
        // setelah simpan, baris baru ada di halaman terakhir dan window digeser
        // mundur supaya tidak cuma berisi satu baris).
        const customOffset = (pagination as any)?.customOffset;
        const offset =
          typeof customOffset === 'number' && customOffset >= 0
            ? customOffset
            : (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'jenisorder_text') {
          query.orderBy('u.jenisorder_nama', sort.sortDirection);
        } else if (sort?.sortBy === 'container_text') {
          query.orderBy('u.container_nama', sort.sortDirection);
        } else if (sort?.sortBy === 'shipper_text') {
          query.orderBy('u.shipper_nama', sort.sortDirection);
        } else if (sort?.sortBy === 'tujuankapal_text') {
          query.orderBy('u.tujuankapal_nama', sort.sortDirection);
        } else if (sort?.sortBy === 'marketing_text') {
          query.orderBy('u.marketing_nama', sort.sortDirection);
        } else if (sort?.sortBy === 'schedule_text') {
          query.orderBy('u.schedule_nama', sort.sortDirection);
        } else if (sort?.sortBy === 'pelayarancontainer_text') {
          query.orderBy('u.pelayarancontainer_nama', sort.sortDirection);
        } else if (sort?.sortBy === 'jenismuatan_text') {
          query.orderBy('u.jenismuatan_nama', sort.sortDirection);
        } else if (sort?.sortBy === 'sandarkapal_text') {
          query.orderBy('u.sandarkapal_nama', sort.sortDirection);
        } else if (sort?.sortBy === 'lokasistuffing_text') {
          query.orderBy('u.lokasistuffing_nama', sort.sortDirection);
        } else if (sort?.sortBy === 'emkllain_text') {
          query.orderBy('u.emkllain_nama', sort.sortDirection);
        } else if (sort?.sortBy === 'daftarbl_text') {
          query.orderBy('u.daftarbl_nama', sort.sortDirection);
        } else if (sort?.sortBy === 'statustradoluar') {
          query.orderByRaw(
            `JSON_VALUE([pivot].tradoluar_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statuspisahbl') {
          query.orderByRaw(
            `JSON_VALUE([pivot].pisahbl_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statusjobptd') {
          query.orderByRaw(
            `JSON_VALUE([pivot].jobptd_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statustransit') {
          query.orderByRaw(
            `JSON_VALUE([pivot].transit_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statusstuffingdepo') {
          query.orderByRaw(
            `JSON_VALUE([pivot].stuffingdepo_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statusopendoor') {
          query.orderByRaw(
            `JSON_VALUE([pivot].opendoor_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statusbatalmuat') {
          query.orderByRaw(
            `JSON_VALUE([pivot].batalmuat_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statussoc') {
          query.orderByRaw(
            `JSON_VALUE([pivot].soc_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statuspengurusandoor') {
          query.orderByRaw(
            `JSON_VALUE([pivot].pengurusandoor_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statusapproval') {
          query.orderByRaw(
            `JSON_VALUE([pivot].approval_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else {
          // Dikualifikasi `u.` — query ini menggabungkan view dengan dua temp
          // table, jadi kolom tanpa prefiks bisa ambigu.
          query.orderBy(`u.${sort.sortBy}`, sort.sortDirection);
        }
        // Tiebreaker unik: tanpa urutan total, offset/limit bisa memulangkan
        // baris yang sama di dua halaman berbeda saat grid menggeser window.
        if (sort.sortBy !== 'id') {
          query.orderBy('u.id', 'asc');
        }
      }

      const countResult = await countQuery.count('* as total').first();
      const total = Number(countResult?.total ?? 0);
      const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
      const data = await query;
      const responseType = total > 500 ? 'json' : 'local';
      // console.log('data', data);

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
      console.error('Error to findAll Booking Orderan Muatan', error);
      throw new Error(error);
    }
  }

  async tempStatusPendukung(trx: any, tablename: string) {
    try {
      const tempStatusPendukung = `##temp_${Math.random().toString(36).substring(2, 15)}`;
      const tempData = `##temp_data${Math.random().toString(36).substring(2, 15)}`;
      const tempHasil = `##temp_hasil${Math.random().toString(36).substring(2, 15)}`;

      // Create tempStatusPendukung table
      await trx.schema.createTable(tempStatusPendukung, (t) => {
        t.bigInteger('id').nullable();
        t.bigInteger('statusdatapendukung').nullable();
        t.bigInteger('transaksi_id').nullable();
        t.string('statuspendukung').nullable();
        t.text('keterangan').nullable();
        t.string('modifiedby').nullable();
        t.string('updated_at').nullable();
        t.string('created_at').nullable();
      });

      // Create tempHasil table
      await trx.schema.createTable(tempData, (t) => {
        t.string('nobukti').nullable();
        t.text('keterangan').nullable();
        t.string('judul').nullable();
      });
      await trx.schema.createTable(tempHasil, (t) => {
        t.string('nobukti').nullable();
        t.text('tradoluar').nullable();
        t.text('tradoluar_nama').nullable();
        t.text('tradoluar_memo').nullable();
        t.text('pisahbl').nullable();
        t.text('pisahbl_nama').nullable();
        t.text('pisahbl_memo').nullable();
        t.text('jobptd').nullable();
        t.text('jobptd_nama').nullable();
        t.text('jobptd_memo').nullable();
        t.text('transit').nullable();
        t.text('transit_nama').nullable();
        t.text('transit_memo').nullable();
        t.text('stuffingdepo').nullable();
        t.text('stuffingdepo_nama').nullable();
        t.text('stuffingdepo_memo').nullable();
        t.text('opendoor').nullable();
        t.text('opendoor_nama').nullable();
        t.text('opendoor_memo').nullable();
        t.text('batalmuat').nullable();
        t.text('batalmuat_nama').nullable();
        t.text('batalmuat_memo').nullable();
        t.text('soc').nullable();
        t.text('soc_nama').nullable();
        t.text('soc_memo').nullable();
        t.text('pengurusandoor').nullable();
        t.text('pengurusandoor_nama').nullable();
        t.text('pengurusandoor_memo').nullable();
        t.text('approval').nullable();
        t.text('approval_nama').nullable();
        t.text('approval_memo').nullable();
      });

      // Insert into tempStatusPendukung
      await trx(tempStatusPendukung).insert(
        trx
          .select(
            'a.id',
            'a.statusdatapendukung',
            'a.transaksi_id',
            'a.statuspendukung',
            'a.keterangan',
            'a.modifiedby',
            'a.updated_at',
            'a.created_at',
          )
          .from('statuspendukung as a')
          .innerJoin('parameter as b', 'a.statusdatapendukung', 'b.id')
          .where('b.subgrp', tablename),
      );

      await trx(tempData).insert(
        trx
          .select(
            'a.nobukti',
            trx.raw(
              `CONCAT(
                '{"statusdatapendukung":"',
                CASE 
                  WHEN (CAST(c.memo AS text) IS JSON) 
                    THEN JSON_VALUE(CAST(c.memo AS text), '$.MEMO') 
                  ELSE '' 
                END,
                '","transaksi_id":',
                TRIM((COALESCE(b.transaksi_id, 0))::text),
                ',"statuspendukung":"',
                CASE 
                  WHEN (CAST(d.memo AS text) IS JSON) 
                    THEN JSON_VALUE(CAST(d.memo AS text), '$.MEMO') 
                  ELSE '' 
                END,
                '","keterangan":"',
                TRIM(COALESCE(b.keterangan, '')),
                '","updated_at":"',
                TO_CHAR(CAST(b.updated_at AS timestamp), 'YYYY-MM-DD HH24:MI:SS'),
                '","statuspendukung_id":"',
                TRIM((COALESCE(d.id, 0))::text),
                '","statuspendukung_memo":',
               TRIM(CAST(d.memo AS text)),
                '}'
              ) AS keterangan`,
            ),
            trx.raw(
              `CASE 
                WHEN (CAST(c.memo AS text) IS JSON) 
                  THEN JSON_VALUE(CAST(c.memo AS text), '$.MEMO') 
                ELSE '' 
              END AS judul`,
            ),
          )
          .from(`${tablename} as a`)
          .innerJoin(`${tempStatusPendukung} as b`, 'a.id', 'b.transaksi_id')
          .innerJoin('parameter as c', 'b.statusdatapendukung', 'c.id')
          .innerJoin('parameter as d', 'b.statuspendukung', 'd.id'),
      );
      // console.log('tempData', await trx(tempData).select('*'));

      // Generate dynamic columns for PIVOT
      const columnsResult = await trx
        .select('judul')
        .from(tempData)
        .groupBy('judul');
      // console.log('columnsResult', columnsResult);

      let columns = '';
      columnsResult.forEach((row, index) => {
        if (index === 0) {
          columns = `[${row.judul}]`;
        } else {
          columns += `, [${row.judul}]`;
        }
      });
      // console.log('columns',columns);

      if (!columns) {
        throw new Error('No columns generated for PIVOT');
      }
      const pivotSubqueryRaw = `
        (
          SELECT nobukti, ${columns}
          FROM (
            SELECT nobukti, judul, keterangan
            FROM ${tempData}
          ) AS SourceTable
          PIVOT (
            MAX(keterangan)
            FOR judul IN (${columns})
          ) AS PivotTable
        ) AS A
      `;

      await trx(tempHasil).insert(
        trx
          .select([
            'A.nobukti',
            trx.raw(
              "JSON_VALUE(A.[trado luar], '$.statuspendukung_id') as tradoluar",
            ),
            trx.raw(
              "JSON_VALUE(A.[trado luar], '$.statuspendukung') as tradoluar_nama",
            ),
            trx.raw(
              "JSON_QUERY(A.[trado luar], '$.statuspendukung_memo') as tradoluar_memo",
            ),
            trx.raw(
              "JSON_VALUE(A.[pisah bl], '$.statuspendukung_id') as pisahbl",
            ),
            trx.raw(
              "JSON_VALUE(A.[pisah bl], '$.statuspendukung') as pisahbl_nama",
            ),
            trx.raw(
              "JSON_QUERY(A.[pisah bl], '$.statuspendukung_memo') as pisahbl_memo",
            ),
            trx.raw(
              "JSON_VALUE(A.[job ptd], '$.statuspendukung_id') as jobptd",
            ),
            trx.raw(
              "JSON_VALUE(A.[job ptd], '$.statuspendukung') as jobptd_nama",
            ),
            trx.raw(
              "JSON_QUERY(A.[job ptd], '$.statuspendukung_memo') as jobptd_memo",
            ),
            trx.raw(
              "JSON_VALUE(A.[transit], '$.statuspendukung_id') as transit",
            ),
            trx.raw(
              "JSON_VALUE(A.[transit], '$.statuspendukung') as transit_nama",
            ),
            trx.raw(
              "JSON_QUERY(A.[transit], '$.statuspendukung_memo') as transit_memo",
            ),
            trx.raw(
              "JSON_VALUE(A.[stuffing depo], '$.statuspendukung_id') as stuffingdepo",
            ),
            trx.raw(
              "JSON_VALUE(A.[stuffing depo], '$.statuspendukung') as stuffingdepo_nama",
            ),
            trx.raw(
              "JSON_QUERY(A.[stuffing depo], '$.statuspendukung_memo') as stuffingdepo_memo",
            ),
            trx.raw(
              "JSON_VALUE(A.[open door], '$.statuspendukung_id') as opendoor",
            ),
            trx.raw(
              "JSON_VALUE(A.[open door], '$.statuspendukung') as opendoor_nama",
            ),
            trx.raw(
              "JSON_QUERY(A.[open door], '$.statuspendukung_memo') as opendoor_memo",
            ),
            trx.raw(
              "JSON_VALUE(A.[batal muat], '$.statuspendukung_id') as batalmuat",
            ),
            trx.raw(
              "JSON_VALUE(A.[batal muat], '$.statuspendukung') as batalmuat_nama",
            ),
            trx.raw(
              "JSON_QUERY(A.[batal muat], '$.statuspendukung_memo') as batalmuat_memo",
            ),
            trx.raw("JSON_VALUE(A.[soc], '$.statuspendukung_id') as soc"),
            trx.raw("JSON_VALUE(A.[soc], '$.statuspendukung') as soc_nama"),
            trx.raw(
              "JSON_QUERY(A.[soc], '$.statuspendukung_memo') as soc_memo",
            ),
            trx.raw(
              "JSON_VALUE(A.[pengurusan door ekspedisi lain], '$.statuspendukung_id') as pengurusandoor",
            ),
            trx.raw(
              "JSON_VALUE(A.[pengurusan door ekspedisi lain], '$.statuspendukung') as pengurusandoor_nama",
            ),
            trx.raw(
              "JSON_QUERY(A.[pengurusan door ekspedisi lain], '$.statuspendukung_memo') as pengurusandoor_memo",
            ),
            trx.raw(
              "JSON_VALUE(A.[approval transaksi], '$.statuspendukung_id') as approval",
            ),
            trx.raw(
              "JSON_VALUE(A.[approval transaksi], '$.statuspendukung') as approval_nama",
            ),
            trx.raw(
              "JSON_QUERY(A.[approval transaksi], '$.statuspendukung_memo') as approval_memo",
            ),
          ])
          .from(trx.raw(pivotSubqueryRaw)),
      );
      // console.log('hasil', await trx(tempHasil).select('*'));

      return tempHasil;
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      const getIdOrderanMuatan = await trx
        .from(trx.raw(`${this.tableName}`))
        .select('id')
        .where('bookingorderan_id', id)
        .first();
      const existingData = await trx(this.tableName)
        .where('id', getIdOrderanMuatan.id)
        .first();
      const {
        container_nama,
        shipper_nama,
        tujuankapal_nama,
        marketing_nama,
        schedule_nama,
        pelayarancontainer_nama,
        jenismuatan_nama,
        sandarkapal_nama,
        tradoluar,
        tradoluar_nama,
        lokasistuffing_nama,
        emkllain_nama,
        daftarbl_nama,
        pisahbl,
        pisahbl_nama,
        jobptd,
        jobptd_nama,
        transit,
        transit_nama,
        stuffingdepo,
        stuffingdepo_nama,
        opendoor,
        opendoor_nama,
        batalmuat,
        batalmuat_nama,
        soc,
        soc_nama,
        pengurusandoorekspedisilain,
        pengurusandoorekspedisilain_nama,
        ...bookingOrderanData
      } = data;

      this.kolomHurufBesar.forEach((field) => {
        if (typeof bookingOrderanData[field] === 'string') {
          bookingOrderanData[field] = bookingOrderanData[field].toUpperCase();
        }
      });

      if ('nominalstuffing' in bookingOrderanData) {
        bookingOrderanData.nominalstuffing = parseNominal(
          bookingOrderanData.nominalstuffing,
        );
      }

      const hasChanges = this.utilsService.hasChanges(
        bookingOrderanData,
        existingData,
      );
      if (hasChanges) {
        bookingOrderanData.updated_at = this.utilsService.getTime();
        await trx(this.tableName)
          .where('id', getIdOrderanMuatan.id)
          .update(bookingOrderanData);
      }

      // EDIT DATA PENDUKUNG BOOKING ORDERAN MUATAN
      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
      const getDataPendukungApproval = await trx('parameter')
        .select(
          trx.raw(`JSON_VALUE(${memoExpr}, '$."NILAI TIDAK"') AS nilai_tidak`),
        )
        .where('grp', 'DATA PENDUKUNG')
        // parameter.subgrp disimpan HURUF BESAR, sedangkan this.tableName huruf
        // kecil. Perbandingan di Postgres peka huruf, jadi baris 'APPROVAL
        // TRANSAKSI' tidak pernah ketemu dan update SELALU gagal dengan
        // "Cannot read properties of undefined (reading 'nilai_tidak')" —
        // artinya EDIT di modul ini tidak pernah bisa tersimpan.
        //
        // Yang di-uppercase NILAI-nya dari sisi JS, bukan kolomnya: UPPER(subgrp)
        // membuat predikat tidak sargable dan membuang idx_parameter_subgrp.
        // Sama persis dengan perbaikan di tempPivotStatusPendukung.
        .where('subgrp', this.tableName.toUpperCase())
        .where('text', 'APPROVAL TRANSAKSI')
        .first();
      const dataPendukungMuatan = {
        'TRADO LUAR': tradoluar,
        'PISAH BL': pisahbl,
        'JOB PTD': jobptd,
        TRANSIT: transit,
        'STUFFING DEPO': stuffingdepo,
        'OPEN DOOR': opendoor,
        'BATAL MUAT': batalmuat,
        SOC: soc,
        'PENGURUSAN DOOR EKSPEDISI LAIN': pengurusandoorekspedisilain,
        'APPROVAL TRANSAKSI': getDataPendukungApproval.nilai_tidak,
      };

      const updateStatusPendukung = await this.statuspendukungService.update(
        this.tableName,
        getIdOrderanMuatan.id,
        bookingOrderanData.modifiedby,
        trx,
        dataPendukungMuatan,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT BOOKING ORDERAN MUATAN',
          idtrans: getIdOrderanMuatan.id,
          nobuktitrans: getIdOrderanMuatan.id,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      return {
        id: getIdOrderanMuatan.id,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      console.error('Error updating booking orderan header:', error);
      throw new Error('Failed to update booking orderan header');
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

      // lockAndDestroy memulangkan `true` (bukan undefined) kalau barisnya tidak
      // ada, sehingga `deletedData.id` diam-diam jadi undefined dan baru meledak
      // di query berikutnya dengan pesan yang tidak menunjuk sebabnya. Dihentikan
      // di sini supaya penyebabnya kelihatan.
      if (!deletedData || deletedData === true || !deletedData.id) {
        throw new NotFoundException(
          `Booking orderan muatan dengan id '${id}' tidak ditemukan`,
        );
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE BOOKING ORDERAN MUATAN',
          idtransss: id,
          nobuktitrans: id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby,
        },
        trx,
      );

      const statusPendukung = await trx
        .from(trx.raw(`statuspendukung`))
        .where('transaksi_id', deletedData.id);
      if (statusPendukung.length > 0) {
        await this.statuspendukungService.remove(
          deletedData.id,
          modifiedby,
          trx,
        );
      }

      return {
        status: 200,
        message: 'Data deleted successfully',
        id: deletedData.id,
        headerId: deletedData.bookingorderan_id,
      };
    } catch (error) {
      console.error('Error deleting data booking orderan muatan: ', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete data booking orderan muatan',
      );
    }
  }

  async findOne(id: string, trx: any) {
    try {
      const query = trx
        .from(trx.raw(`${this.tableName} as u`))
        .select([
          'u.id as id',
          'u.bookingorderan_id',
          'u.nobukti',
          'u.container_id',
          'u.shipper_id',
          'u.tujuankapal_id',
          'u.marketing_id',
          'u.keterangan',
          'u.schedule_id',
          'u.pelayarancontainer_id',
          'u.jenismuatan_id',
          'u.sandarkapal_id',
          'u.nopolisi',
          'u.nosp',
          'u.nocontainer',
          'u.noseal',
          'u.lokasistuffing',
          'u.nominalstuffing',
          'u.emkl_id as emkl_id',
          'u.asalmuatan',
          'u.daftarbl_id',
          'u.comodity',
          'u.gandengan',
          'u.modifiedby',
          trx.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),

          'header.id as header_id',
          'header.nobukti as header_nobukti',
          trx.raw("TO_CHAR(header.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'header.jenisorder_id',
          'jenisorderan.nama as jenisorder_nama',
          'header.statusformat',

          'container.nama as container_nama',
          'shipper.nama as shipper_nama',
          'tujuankapal.nama as tujuankapal_nama',
          'marketing.nama as marketing_nama',
          'schedulekapal.voyberangkat as schedule_nama',
          'pelayaran.nama as pelayarancontainer_nama',
          'jenismuatan.nama as jenismuatan_nama',
          'sandarkapal.nama as sandarkapal_nama',
          'hargatrucking.keterangan as lokasistuffing_nama',
          'emkl.nama as emkllain_nama',
          'daftarbl.nama as daftarbl_nama',
        ])
        .leftJoin(
          'bookingorderanheader as header',
          'u.nobukti',
          'header.nobukti',
        )
        .leftJoin(
          'jenisorder as jenisorderan',
          'header.jenisorder_id',
          'jenisorderan.id',
        )
        .leftJoin('container', 'u.container_id', 'container.id')
        .leftJoin('shipper', 'u.shipper_id', 'shipper.id')
        .leftJoin('tujuankapal', 'u.tujuankapal_id', 'tujuankapal.id')
        .leftJoin('marketing', 'u.marketing_id', 'marketing.id')
        .leftJoin('schedulekapal', 'u.schedule_id', 'schedulekapal.id')
        .leftJoin('pelayaran', 'u.pelayarancontainer_id', 'pelayaran.id')
        .leftJoin('jenismuatan', 'u.jenismuatan_id', 'jenismuatan.id')
        .leftJoin('sandarkapal', 'u.sandarkapal_id', 'sandarkapal.id')
        .leftJoin(
          'hargatrucking',
          trx.raw('u.lokasistuffing::text'),
          'hargatrucking.id',
        )
        .leftJoin('emkl', 'u.emkl_id', 'emkl.id')
        .leftJoin('daftarbl', 'u.daftarbl_id', 'daftarbl.id')
        .where('u.id', id);

      const data = await query;
      console.log('data', data);

      return {
        data: data,
      };
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async checkValidasi(aksi: string, value: any, editedby: any, trx: any) {
    try {
      if (aksi === 'EDIT') {
        const getIdHeader = await trx(this.tableName)
          .select('bookingorderan_id')
          .where('id', value)
          .first();
        const cekOrderanNoBukti = await trx('bookingorderanheader')
          .select('orderan_nobukti')
          .where('id', getIdHeader.bookingorderan_id)
          .first();

        if (
          cekOrderanNoBukti?.orderan_nobukti &&
          cekOrderanNoBukti?.orderan_nobukti !== null
        ) {
          const validasi = await this.globalService.checkUsed(
            'orderanheader',
            'nobukti',
            cekOrderanNoBukti.orderan_nobukti,
            trx,
          );

          if (validasi.status === 'failed') {
            return {
              status: 'failed',
              message: `Data ini tidak diizinkan untuk diedit, silahkan edit dari orderan.`,
            };
          }
          return validasi;
        } else {
          const forceEdit = await this.locksService.forceEdit(
            this.tableName,
            value,
            editedby,
            trx,
          );
          return forceEdit;
        }
      } else if (aksi === 'DELETE') {
        const getIdHeader = await trx(this.tableName)
          .select('bookingorderan_id')
          .where('id', value)
          .first();
        const cekOrderanNoBukti = await trx('bookingorderanheader')
          .select('orderan_nobukti')
          .where('id', getIdHeader.bookingorderan_id)
          .first();

        const validasi = await this.globalService.checkUsed(
          'orderanheader',
          'nobukti',
          cekOrderanNoBukti.orderan_nobukti,
          trx,
        );
        return validasi;
      }
    } catch (error) {
      console.error('Error di checkValidasi:', error);
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      console.error('Error di checkValidasi booking orderan muatan:', error);
      throw new Error('Error di checkValidasi booking orderan muatan');
    }
  }
}
