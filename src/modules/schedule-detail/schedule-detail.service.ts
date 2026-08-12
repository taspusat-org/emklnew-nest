import { Injectable, Logger } from '@nestjs/common';
import {
  withUuidV7,
  formatDateToSQL,
  UtilsService,
} from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { ScheduleKapalService } from '../schedule-kapal/schedule-kapal.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class ScheduleDetailService {
  private readonly tableName = 'scheduledetail';
  private readonly logger = new Logger(ScheduleDetailService.name);

  // Kolom yang ikut disapu kotak SEARCH di grid = kolom yang tampil di grid.
  private static readonly SEARCHABLE_COLUMNS = [
    'nobukti',
    'pelayaran',
    'kapal',
    'tujuankapal',
    'tglberangkat',
    'tgltiba',
    'etb',
    'eta',
    'etd',
    'voyberangkat',
    'voytiba',
    'closing',
    'etatujuan',
    'etdtujuan',
    'keterangan',
  ];

  private static readonly FILTERABLE_COLUMNS = new Set([
    ...ScheduleDetailService.SEARCHABLE_COLUMNS,
    'modifiedby',
    'created_at',
    'updated_at',
  ]);

  // Kolom tanggal (date) — ditampilkan & difilter sebagai teks DD-MM-YYYY.
  private static readonly DATE_COLUMNS = [
    'tglberangkat',
    'tgltiba',
    'etb',
    'eta',
    'etd',
    'etatujuan',
    'etdtujuan',
  ];

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly scheduleKapalService: ScheduleKapalService,
  ) {}

  /**
   * `closing` bertipe timestamp dan datang dari InputDateTimePicker sebagai
   * "DD-MM-YYYY hh:mm AM". formatDateTimeToSQL hanya menukar pemisahnya, jadi
   * bagian tanggalnya tetap DD-MM-YYYY (tak terbaca Postgres) dan penanda
   * AM/PM-nya hilang — jam sore tersimpan sebagai jam pagi.
   */
  private toSqlDateTime(value: any): string | null {
    const raw = String(value ?? '').trim();
    if (!raw || raw === 'undefined' || raw === 'null') return null;

    const [datePart, ...timeParts] = raw.replace('T', ' ').split(' ');
    const date = formatDateToSQL(datePart);
    if (!date) return null;

    const time = timeParts.join(' ').trim();
    const parsed = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(time);
    if (!parsed) return `${date} 00:00:00`;

    let hour = Number(parsed[1]);
    const meridiem = parsed[4]?.toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;

    return `${date} ${String(hour).padStart(2, '0')}:${parsed[2]}:${
      parsed[3] ?? '00'
    }`;
  }

  /**
   * Satu baris detail siap simpan. Tanggal dinormalkan ke bentuk SQL, kolom
   * teks manusiawi di-uppercase; id/FK adalah UUID bertipe text (case
   * sensitive) sehingga TIDAK boleh ikut di-uppercase.
   */
  private buildDetailRow(detail: any, scheduleId: string): Record<string, any> {
    const upper = (value: any) =>
      value === null || value === undefined || value === ''
        ? null
        : String(value).toUpperCase();

    return {
      schedule_id: detail.schedule_id ?? scheduleId,
      nobukti: detail.nobukti ? String(detail.nobukti).toUpperCase() : null,
      pelayaran_id: detail.pelayaran_id ? String(detail.pelayaran_id) : null,
      kapal_id: detail.kapal_id ? String(detail.kapal_id) : null,
      tujuankapal_id: detail.tujuankapal_id
        ? String(detail.tujuankapal_id)
        : null,
      schedulekapal_id: detail.schedulekapal_id
        ? String(detail.schedulekapal_id)
        : null,
      tglberangkat: formatDateToSQL(detail.tglberangkat),
      tgltiba: formatDateToSQL(detail.tgltiba),
      etb: formatDateToSQL(detail.etb),
      eta: formatDateToSQL(detail.eta),
      etd: formatDateToSQL(detail.etd),
      // NOT NULL di tabel, jadi kosong disimpan sebagai string kosong.
      voyberangkat: upper(detail.voyberangkat) ?? '',
      voytiba: upper(detail.voytiba) ?? '',
      closing: this.toSqlDateTime(detail.closing),
      etatujuan: formatDateToSQL(detail.etatujuan),
      etdtujuan: formatDateToSQL(detail.etdtujuan),
      keterangan: upper(detail.keterangan),
      info: detail.info ?? null,
      modifiedby: upper(detail.modifiedby),
    };
  }

  /**
   * schedulekapal adalah master jadwal kapal yang dipakai bersama modul lain.
   * Kombinasi kapal + pelayaran + tujuan + tgl/voy berangkat yang belum ada
   * dibuatkan barisnya, yang sudah ada dipakai ulang.
   */
  private async resolveScheduleKapalId(
    row: Record<string, any>,
    modifiedby: any,
    trx: any,
  ): Promise<string | null> {
    if (!row.kapal_id || !row.pelayaran_id || !row.tglberangkat) return null;

    // Dicari langsung, bukan lewat ScheduleKapalService.findAll: filter di sana
    // memakai ILIKE untuk semua key, dan ILIKE tidak berlaku pada kolom date.
    const existing = await trx('schedulekapal')
      .select('id')
      .where('kapal_id', row.kapal_id)
      .andWhere('pelayaran_id', row.pelayaran_id)
      .andWhere('tglberangkat', row.tglberangkat)
      .modify((qb: any) => {
        // Pencocokan HARUS mencakup kolom yang kosong juga: tanpa itu baris
        // tanpa voy berangkat cocok dengan baris mana pun yang voy-nya terisi.
        if (row.tujuankapal_id) {
          qb.andWhere('tujuankapal_id', row.tujuankapal_id);
        } else {
          qb.whereNull('tujuankapal_id');
        }
        if (row.voyberangkat) {
          qb.andWhere('voyberangkat', row.voyberangkat);
        } else {
          qb.andWhere((sub: any) =>
            sub.whereNull('voyberangkat').orWhere('voyberangkat', ''),
          );
        }
      })
      .first();

    if (existing) return existing.id;

    const inserted = await this.scheduleKapalService.create(
      {
        kapal_id: row.kapal_id,
        pelayaran_id: row.pelayaran_id,
        tglberangkat: row.tglberangkat,
        voyberangkat: row.voyberangkat,
        tujuankapal_id: row.tujuankapal_id,
        modifiedby,
      },
      trx,
    );

    return inserted.newData.id;
  }

  /**
   * Upsert seluruh rincian satu schedule dalam sekali panggil: baris lama
   * di-update, baris yang tidak dikirim lagi dihapus, baris baru di-insert.
   *
   * Rewrite Postgres: TANPA temp table + OPENJSON (OPENJSON = fungsi SQL
   * Server, tak ada di PG).
   */
  async create(details: any, id: any = 0, trx: any = null) {
    const time = this.utilsService.getTime();
    const logData: any[] = [];

    if (!details || details.length === 0) {
      await trx(this.tableName).delete().where('schedule_id', id);
      return;
    }

    const existingRows: any[] = []; // baris dgn id nyata (bukan '0'/kosong)
    const newRows: any[] = [];

    for (const detail of details) {
      const row = this.buildDetailRow(detail, id);
      row.schedulekapal_id =
        (await this.resolveScheduleKapalId(row, row.modifiedby, trx)) ??
        row.schedulekapal_id;

      const isNew = !detail.id || String(detail.id) === '0';
      if (isNew) {
        row.created_at = time;
        row.updated_at = time;
        logData.push({ ...row, aksi: 'CREATE' });
        newRows.push(row);
        continue;
      }

      row.id = String(detail.id);
      const existingData = await trx(this.tableName)
        .where('id', row.id)
        .first();

      if (existingData) {
        row.created_at = existingData.created_at;
        row.updated_at = this.utilsService.hasChanges(row, existingData)
          ? time
          : existingData.updated_at;
        logData.push({
          ...row,
          aksi: row.updated_at === time ? 'UPDATE' : 'NO UPDATE',
        });
      } else {
        row.created_at = time;
        row.updated_at = time;
        logData.push({ ...row, aksi: 'NO UPDATE' });
      }

      existingRows.push(row);
    }

    let updatedData: any = null;
    for (const row of existingRows) {
      const { id: rowId, ...values } = row;
      const res = await trx(this.tableName)
        .where('id', rowId)
        .update(values)
        .returning('*');
      if (res && res[0]) updatedData = res[0];
    }

    // Baris di DB (schedule_id = id) yang tak dikirim lagi → log DELETE, hapus.
    const incomingIds = existingRows.map((r) => r.id);
    const getDeleted = await trx(this.tableName)
      .where('schedule_id', id)
      .modify((qb: any) => {
        if (incomingIds.length) qb.whereNotIn('id', incomingIds);
      })
      .select('*');

    const finalData = logData.concat(
      getDeleted.map((entry: any) => ({ ...entry, aksi: 'DELETE' })),
    );

    await trx(this.tableName)
      .where('schedule_id', id)
      .modify((qb: any) => {
        if (incomingIds.length) qb.whereNotIn('id', incomingIds);
      })
      .del();

    let insertedData: any = null;
    if (newRows.length > 0) {
      insertedData = await trx(this.tableName)
        .insert(await withUuidV7(trx, newRows))
        .returning('*')
        .then((result: any) => result[0]);
    }

    await this.logTrailService.create(
      {
        namatabel: this.tableName,
        postingdari: 'SCHEDULE DETAIL',
        idtrans: id,
        nobuktitrans: id,
        aksi: 'EDIT',
        datajson: JSON.stringify(finalData),
        modifiedby: details[0].modifiedby || 'unknown',
      },
      trx,
    );

    return updatedData || insertedData;
  }

  // Ekspresi SQL per kolom grid. Sebagian kolom yang tampil bukan kolom base:
  // pelayaran/kapal/tujuankapal datang dari tabel master, tanggal ditampilkan
  // sebagai teks. Filter, search, dan sort harus memakai ekspresi yang sama
  // dengan yang di-select supaya hasilnya cocok dengan yang dilihat user.
  private filterExpression(trx: any, key: string) {
    switch (key) {
      case 'pelayaran':
      case 'pelayaran_nama':
        return trx.raw('pel.nama');
      case 'kapal':
      case 'kapal_nama':
        return trx.raw('kapal.nama');
      case 'tujuankapal':
      case 'tujuankapal_nama':
        return trx.raw('q.nama');
      case 'closing':
        return trx.raw("TO_CHAR(p.closing, 'DD-MM-YYYY HH24:MI:SS')");
      case 'created_at':
      case 'updated_at':
        return trx.raw(`TO_CHAR(p.${key}, 'DD-MM-YYYY HH24:MI:SS')`);
      default:
        return ScheduleDetailService.DATE_COLUMNS.includes(key)
          ? trx.raw(`TO_CHAR(p.${key}, 'DD-MM-YYYY')`)
          : trx.raw(`p.${key}`);
    }
  }

  // Sort dari grid dipakai sebagai primary order, jadi ekspresinya harus
  // ekspresi asli (bukan teks) supaya tanggal terurut benar.
  private sortExpression(trx: any, key: string) {
    switch (key) {
      case 'pelayaran':
      case 'pelayaran_nama':
        return trx.raw('pel.nama');
      case 'kapal':
      case 'kapal_nama':
        return trx.raw('kapal.nama');
      case 'tujuankapal':
      case 'tujuankapal_nama':
        return trx.raw('q.nama');
      default:
        return trx.raw(`p.${key}`);
    }
  }

  private applyFilters(
    trx: any,
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    if (search) {
      const sanitized = String(search).trim();

      qb.where((builder: any) => {
        ScheduleDetailService.SEARCHABLE_COLUMNS.forEach((field) => {
          builder.orWhere(
            this.filterExpression(trx, field),
            'ilike',
            `%${sanitized}%`,
          );
        });
      });
    }

    for (const [key, value] of Object.entries(filters || {})) {
      // Key di luar whitelist (tglDari/tglSampai, *_id) bukan kolom grid dan
      // akan membuat query gagal kalau diteruskan apa adanya.
      if (!ScheduleDetailService.FILTERABLE_COLUMNS.has(key)) continue;
      if (value === null || value === undefined || value === '') continue;

      qb.andWhere(
        this.filterExpression(trx, key),
        'ilike',
        `%${String(value)}%`,
      );
    }
  }

  private baseQuery(trx: any) {
    return trx(`${this.tableName} as p`)
      .select(
        'p.id',
        'p.schedule_id',
        'p.nobukti',
        'p.pelayaran_id',
        'p.kapal_id',
        'p.tujuankapal_id',
        'p.schedulekapal_id',
        trx.raw("TO_CHAR(p.tglberangkat, 'DD-MM-YYYY') as tglberangkat"),
        trx.raw("TO_CHAR(p.tgltiba, 'DD-MM-YYYY') as tgltiba"),
        trx.raw("TO_CHAR(p.etb, 'DD-MM-YYYY') as etb"),
        trx.raw("TO_CHAR(p.eta, 'DD-MM-YYYY') as eta"),
        trx.raw("TO_CHAR(p.etd, 'DD-MM-YYYY') as etd"),
        'p.voyberangkat',
        'p.voytiba',
        trx.raw("TO_CHAR(p.closing, 'DD-MM-YYYY HH24:MI:SS') as closing"),
        trx.raw(
          'TO_CHAR(p.closing, \'DD-MM-YYYY HH12:MI AM\') as "closingForDateTime"',
        ),
        trx.raw("TO_CHAR(p.etatujuan, 'DD-MM-YYYY') as etatujuan"),
        trx.raw("TO_CHAR(p.etdtujuan, 'DD-MM-YYYY') as etdtujuan"),
        'p.keterangan',
        'p.info',
        'p.modifiedby',
        trx.raw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
        trx.raw("TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
        'pel.nama as pelayaran_nama',
        'kapal.nama as kapal_nama',
        'q.nama as tujuankapal_nama',
      )
      .leftJoin('pelayaran as pel', 'p.pelayaran_id', 'pel.id')
      .leftJoin('kapal', 'p.kapal_id', 'kapal.id')
      .leftJoin('tujuankapal as q', 'p.tujuankapal_id', 'q.id');
  }

  async findAll(
    id: string,
    trx: any,
    { search, filters, pagination, sort }: FindAllParams,
  ) {
    const { page = 1, limit = 0 } = pagination ?? {};

    if (!id) {
      // Bentuk balikan tetap lengkap supaya grid yang membaca
      // pagination.totalItems saat header belum dipilih tidak menemukan
      // undefined lalu menghitung totalPages = NaN.
      return {
        status: false,
        message: 'No data found',
        data: [],
        total: 0,
        pagination: {
          currentPage: Number(page),
          totalPages: 0,
          totalItems: 0,
          itemsPerPage: Number(limit),
        },
      };
    }

    try {
      const safeFilters = filters || {};

      const countResult = await trx(`${this.tableName} as p`)
        .leftJoin('pelayaran as pel', 'p.pelayaran_id', 'pel.id')
        .leftJoin('kapal', 'p.kapal_id', 'kapal.id')
        .leftJoin('tujuankapal as q', 'p.tujuankapal_id', 'q.id')
        .where('p.schedule_id', id)
        .modify((qb: any) => this.applyFilters(trx, qb, safeFilters, search))
        .count('p.id as total')
        .first();
      const total = Number(countResult?.total ?? 0);

      const query = this.baseQuery(trx).where('p.schedule_id', id);
      query.modify((qb: any) =>
        this.applyFilters(trx, qb, safeFilters, search),
      );

      // Urutan HARUS deterministik: tanpa itu offset/limit bisa memulangkan
      // baris yang sama di dua halaman berbeda saat grid menggeser window.
      const sortBy = sort?.sortBy || 'id';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';

      query.orderBy(this.sortExpression(trx, sortBy), sortDirection);
      if (sortBy !== 'created_at') {
        query.orderBy('p.created_at', 'asc');
      }
      if (sortBy !== 'id') {
        query.orderBy('p.id', 'asc');
      }

      // limit 0/undefined = ambil semua. Dipakai pemanggil non-grid yang butuh
      // seluruh detail satu bukti sekaligus (FormSchedule, cetak, export).
      if (Number(limit) > 0) {
        query.offset((Number(page) - 1) * Number(limit)).limit(Number(limit));
      }

      const result = await query;
      const totalPages =
        Number(limit) > 0 ? Math.ceil(total / Number(limit)) : 1;

      return {
        status: result.length > 0,
        message:
          result.length > 0
            ? 'Schedule Detail data fetched successfully'
            : 'No Data Schedule Detail Found',
        data: result,
        total,
        pagination: {
          currentPage: Number(page),
          totalPages,
          totalItems: total,
          itemsPerPage: Number(limit),
        },
      };
    } catch (error) {
      console.error('Error in findAll Schedule Detail', error);
      throw new Error(error);
    }
  }

  /**
   * Rincian satu schedule untuk export. Dikembalikan sebagai query (bukan
   * array) supaya ExportJobService bisa men-stream-nya lewat cursor.
   */
  buildExportQuery(scheduleId: string, db: any) {
    // Urutan HARUS deterministik: tanpa tiebreak, dua baris dengan tanggal
    // berangkat sama bisa bertukar posisi antar-batch cursor.
    return this.baseQuery(db)
      .where('p.schedule_id', scheduleId)
      .orderBy('p.id', 'asc');
  }

  /** Jumlah baris yang akan diekspor — dipakai untuk progres export yang nyata. */
  async countExportRows(scheduleId: string, db: any): Promise<number> {
    const result = await db(this.tableName)
      .count('id as total')
      .where('schedule_id', scheduleId)
      .first();

    return Number(result?.total ?? 0);
  }
}
