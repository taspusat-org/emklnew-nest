import { Injectable, Logger } from '@nestjs/common';
import { UpdatePengembaliankasgantungdetailDto } from './dto/update-pengembaliankasgantungdetail.dto';
import { withUuidV7, UtilsService } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class PengembaliankasgantungdetailService {
  private readonly tableName = 'pengembaliankasgantungdetail';
  // Baca lewat view (lihat sql/views/pengembaliankasgantung.sql), tulis lewat
  // tabel base — pola yang sama dengan vjurnalumumdetail / vpenerimaandetail.
  // View sudah memuat keterangan bukti kas gantung + link sehingga findAll
  // tidak perlu JOIN di tiap request; itu syarat agar windowed pagination
  // (grid menarik 5 halaman sekaligus) tetap murah.
  private readonly viewName = 'vpengembaliankasgantungdetail';
  private readonly logger = new Logger(
    PengembaliankasgantungdetailService.name,
  );

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}

  // nominal bertipe money/numeric. Grid mengirimnya lewat InputCurrency sebagai
  // string ter-format ("100,000.00"); koma ribuan ditolak PG dengan 22P02
  // invalid input syntax for type numeric. Kosong -> null (kolom nullable).
  private toNumeric(value: any): number | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const parsed = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isNaN(parsed) ? null : parsed;
  }

  /**
   * vpengembaliankasgantungdetail memangkas barisnya sendiri lewat
   * `tas.pengembaliankasgantung_nobukti`, jadi filter per-bukti sudah
   * diterapkan sebelum LEFT JOIN kasgantungheader.
   *
   * `set_config(..., true)` hanya hidup selama transaksi — findAll tetap
   * memasang WHERE nobukti eksplisit untuk jalur tanpa trx (cetak/export
   * bukti yang berjalan di background).
   */
  private async setSessionContext(
    trx: any,
    filters: Record<string, any>,
  ): Promise<void> {
    if (filters?.nobukti) {
      await trx.raw(
        `SELECT set_config('tas.pengembaliankasgantung_nobukti', ?, true)`,
        [String(filters.nobukti)],
      );
    }
  }

  /**
   * Upsert rincian satu bukti.
   *
   * Rewrite Postgres: TANPA temp table + OPENJSON. OPENJSON adalah fungsi SQL
   * Server (tak ada di PG) dan `##temp_` adalah temp table global bergaya
   * MSSQL, jadi versi lama tidak pernah bisa jalan di Postgres. Upsert langsung
   * dari array JS: update per-baris existing, hapus baris yang tak dikirim
   * (whereNotIn), insert baris baru dgn withUuidV7.
   */
  async create(details: any, id: any = 0, trx: any = null) {
    const time = this.utilsService.getTime();
    const logData: any[] = [];

    if (!details || details.length === 0) {
      await trx(this.tableName).delete().where('pengembaliankasgantung_id', id);
      return null;
    }

    const existingRows: any[] = []; // baris dgn id nyata (bukan '0'/kosong)
    const newRows: any[] = [];

    for (const data of details) {
      data.nominal = this.toNumeric(data.nominal);
      // id kosong atau '0' = baris baru; pengirim antar-service memakai '0'.
      const isNew = !data.id || String(data.id) === '0';

      if (!isNew) {
        // Pembanding diambil dari TABEL, bukan view: view meng-format
        // created_at/updated_at, sehingga hasil bacaan itu ditulis balik ke
        // kolom timestamp dalam format yang ditolak Postgres.
        const existingData = await trx(this.tableName)
          .where('id', data.id)
          .first();
        if (existingData) {
          data.created_at = existingData.created_at;
          data.updated_at = existingData.updated_at;
          if (this.utilsService.hasChanges(data, existingData)) {
            data.updated_at = time;
            data.aksi = 'UPDATE';
          } else {
            data.aksi = 'NO UPDATE';
          }
        } else {
          data.aksi = 'NO UPDATE';
        }
        existingRows.push(data);
      } else {
        data.created_at = time;
        data.updated_at = time;
        data.aksi = 'CREATE';
        newRows.push(data);
      }
      logData.push({ ...data, created_at: time });
    }

    // Kolom ditulis eksplisit supaya baris yang sudah ada tidak kehilangan
    // tautannya: penerimaandetail_id di-set ulang tiap simpan karena rincian
    // penerimaan pasangannya ikut ditulis ulang oleh header.
    let updatedData: any = null;
    for (const row of existingRows) {
      const res = await trx(this.tableName)
        .where('id', row.id)
        .update({
          nobukti: row.nobukti ?? '',
          kasgantung_nobukti: row.kasgantung_nobukti ?? '',
          keterangan: row.keterangan ?? null,
          nominal: row.nominal,
          info: row.info ?? null,
          modifiedby: row.modifiedby ?? '',
          pengembaliankasgantung_id: row.pengembaliankasgantung_id ?? id,
          penerimaandetail_id: row.penerimaandetail_id ?? null,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })
        .returning('*');
      if (res && res[0]) updatedData = res[0];
    }

    // Baris di DB (pengembaliankasgantung_id = id) yang tak dikirim lagi ->
    // log DELETE, hapus.
    const incomingIds = existingRows.map((r) => r.id);
    const getDeleted = await trx(this.tableName)
      .where('pengembaliankasgantung_id', id)
      .modify((qb: any) => {
        if (incomingIds.length) qb.whereNotIn('id', incomingIds);
      })
      .select('*');
    const pushToLogWithAction = getDeleted.map((entry: any) => ({
      ...entry,
      aksi: 'DELETE',
    }));
    const finalData = logData.concat(pushToLogWithAction);

    await trx(this.tableName)
      .where('pengembaliankasgantung_id', id)
      .modify((qb: any) => {
        if (incomingIds.length) qb.whereNotIn('id', incomingIds);
      })
      .del();

    // INSERT baris baru dgn uuid v7. Setiap kolom ditulis EKSPLISIT (termasuk
    // yang bernilai null): kolom yang dibiarkan undefined ditulis knex sebagai
    // `DEFAULT`, dan default kolom *_nobukti di skema ini adalah '' — bukan
    // nilai yang diinginkan.
    let insertedData: any = null;
    if (newRows.length > 0) {
      const toInsert = newRows.map((r: any) => ({
        nobukti: r.nobukti ?? '',
        kasgantung_nobukti: r.kasgantung_nobukti ?? '',
        keterangan: r.keterangan ?? null,
        nominal: r.nominal,
        info: r.info ?? null,
        modifiedby: r.modifiedby ?? '',
        pengembaliankasgantung_id: r.pengembaliankasgantung_id ?? id,
        penerimaandetail_id: r.penerimaandetail_id ?? null,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
      insertedData = await trx(this.tableName)
        .insert(await withUuidV7(trx, toInsert))
        .returning('*')
        .then((result: any) => result[0]);
    }

    await this.logTrailService.create(
      {
        namatabel: this.tableName,
        postingdari: 'PENGEMBALIAN KAS GANTUNG DETAIL',
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

  /**
   * Filter + search, dipakai bersama oleh query COUNT dan query DATA supaya
   * total & halaman selalu konsisten. Semua kolom dirujuk lewat alias `p` yang
   * menunjuk ke view (kasgantung_keterangan & link sudah jadi kolom view,
   * bukan hasil JOIN ad-hoc).
   */
  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    // nobukti diurus terpisah (exact match) oleh pemanggil; sisanya bukan
    // kolom tabel ini dan akan membuat query gagal kalau diteruskan apa adanya.
    const excludeSearchKeys = [
      'nobukti',
      'pengembaliankasgantung_id',
      'penerimaandetail_id',
      'tglDari',
      'tglSampai',
    ];

    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );

    if (search && searchFields.length > 0) {
      const sanitizedValue = String(search).replace(/\[/g, '[[]').trim();

      qb.where((query: any) => {
        searchFields.forEach((field) => {
          if (
            ['created_at', 'updated_at', 'kasgantung_tglbukti'].includes(field)
          ) {
            query.orWhereRaw("TO_CHAR(p.??, 'DD-MM-YYYY HH24:MI:SS') ilike ?", [
              field,
              `%${sanitizedValue}%`,
            ]);
          } else if (field === 'nominal') {
            // Bertipe numeric: wajib cast ke text dulu. `like` langsung ke
            // kolom numeric bikin "operator does not exist: numeric ~~ unknown".
            query.orWhereRaw('p.??::text like ?', [
              field,
              `%${sanitizedValue}%`,
            ]);
          } else {
            query.orWhere(`p.${field}`, 'ilike', `%${sanitizedValue}%`);
          }
        });
      });
    }

    for (const [key, value] of Object.entries(filters || {})) {
      if (excludeSearchKeys.includes(key)) continue;
      if (value === null || value === undefined || value === '') continue;

      const sanitizedValue = String(value).replace(/\[/g, '[[]');
      switch (key) {
        case 'created_at':
        case 'updated_at':
        case 'kasgantung_tglbukti':
          qb.andWhereRaw("TO_CHAR(p.??, 'DD-MM-YYYY HH24:MI:SS') ilike ?", [
            key,
            `%${sanitizedValue}%`,
          ]);
          break;
        case 'nominal':
          qb.andWhereRaw('p.??::text like ?', [key, `%${sanitizedValue}%`]);
          break;
        default:
          qb.andWhere(`p.${key}`, 'ilike', `%${sanitizedValue}%`);
      }
    }
  }

  async findAll(
    { search, filters, pagination, sort, useCustomOffset }: FindAllParams,
    trx: any,
  ) {
    const { page = 1, limit = 0, customOffset } = pagination ?? {};

    if (!filters?.nobukti) {
      // Bentuk balikan tetap lengkap (bukan cuma `{ data: [] }`) supaya grid
      // yang membaca pagination.totalItems saat header belum dipilih tidak
      // menemukan undefined lalu menghitung totalPages = NaN.
      return {
        status: false,
        message: 'No data found',
        data: [],
        type: 'local',
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
      const sortBy = sort?.sortBy || 'nobukti';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';

      await this.setSessionContext(trx, safeFilters);

      // set_config di atas sudah memangkas view, tapi WHERE eksplisit tetap
      // dipasang supaya rincian bukti lain tidak bocor kalau session context
      // tidak berlaku — pemanggil tanpa transaksi (cetak/export bukti) memang
      // begitu, karena set_config(..., true) hanya hidup selama transaksi.
      const scoped = (qb: any) => {
        qb.where('p.nobukti', String(safeFilters.nobukti));
        this.applyFilters(qb, safeFilters, search);
      };

      // COUNT dari view, bukan tabel base: filter grid boleh menyentuh
      // kasgantung_keterangan — kolom turunan yang hanya ada di view —
      // sehingga count dari base akan meleset saat filter itu aktif.
      const countResult = await trx(`${this.viewName} as p`)
        .modify(scoped)
        .count('p.id as total')
        .first();
      const total = Number(countResult?.total ?? 0);

      const query = trx(`${this.viewName} as p`)
        .select(
          'p.id',
          'p.pengembaliankasgantung_id',
          'p.nobukti',
          'p.kasgantung_nobukti',
          'p.keterangan',
          'p.nominal',
          'p.penerimaandetail_id',
          'p.kasgantung_keterangan',
          trx.raw(
            "TO_CHAR(p.kasgantung_tglbukti, 'DD-MM-YYYY') as kasgantung_tglbukti",
          ),
          'p.info',
          'p.modifiedby',
          trx.raw(
            "TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
          'p.link',
        )
        .modify(scoped);

      // Urutan HARUS deterministik: tanpa itu offset/limit bisa memulangkan
      // baris yang sama di dua halaman berbeda (atau melewatkan baris) saat
      // grid menggeser window. sortBy dari grid jadi primary, lalu created_at
      // (urutan input antar batch), lalu id (PK, unik) sebagai tiebreaker
      // terakhir — seluruh detail satu bukti di-insert dalam satu batch
      // sehingga created_at-nya identik.
      query.orderBy(`p.${sortBy}`, sortDirection);
      if (sortBy !== 'created_at') {
        query.orderBy('p.created_at', 'asc');
      }
      if (sortBy !== 'id') {
        query.orderBy('p.id', 'asc');
      }

      const offset =
        useCustomOffset === true && customOffset !== undefined
          ? customOffset
          : (Number(page) - 1) * Number(limit);

      // limit 0/undefined = ambil semua. Dipakai pemanggil non-grid yang butuh
      // seluruh detail satu bukti sekaligus (FormPengembalianKasGantung, total
      // nominal di laporan, export bukti).
      if (Number(limit) > 0) {
        query.offset(offset).limit(Number(limit));
      }

      const data = await query;

      const totalPages =
        Number(limit) > 0 ? Math.ceil(total / Number(limit)) : 1;
      const responseType = total > 500 ? 'json' : 'local';

      return {
        status: data.length > 0,
        message:
          data.length > 0
            ? 'Pengembalian Kas Gantung Detail data fetched successfully'
            : 'No data found',
        data,
        type: responseType,
        total,
        pagination: {
          currentPage: Number(page),
          totalPages,
          totalItems: total,
          itemsPerPage: Number(limit),
        },
      };
    } catch (error) {
      console.error('Error in findAll Pengembalian Kas Gantung Detail', error);
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} pengembaliankasgantungdetail`;
  }

  update(
    id: string,
    updatePengembaliankasgantungdetailDto: UpdatePengembaliankasgantungdetailDto,
  ) {
    return `This action updates a #${id} pengembaliankasgantungdetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} pengembaliankasgantungdetail`;
  }
}
