import { Injectable, Logger } from '@nestjs/common';
import { UpdatePenerimaandetailDto } from './dto/update-penerimaandetail.dto';
// `tandatanya` tidak dipakai lagi: kolom `link` dibangun di dalam view
// vpenerimaandetail, bukan di query knex.
import { withUuidV7, UtilsService } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class PenerimaandetailService {
  private readonly tableName = 'penerimaandetail';
  // Baca lewat view (lihat sql/views/penerimaan.sql), tulis lewat tabel base —
  // pola yang sama dengan pengeluarandetail (vpengeluarandetail). View sudah
  // memuat coa_text & link sehingga findAll tidak perlu JOIN + membangun link
  // di tiap request; itu syarat agar windowed pagination (grid menarik 5
  // halaman sekaligus) tetap murah.
  private readonly viewName = 'vpenerimaandetail';
  private readonly logger = new Logger(PenerimaandetailService.name);

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}

  // nominal bertipe numeric. Grid mengirimnya lewat InputCurrency sebagai
  // string ter-format ("100,000.00"); koma ribuan ditolak PG dengan 22P02
  // invalid input syntax for type numeric. Kosong -> null (kolom nullable).
  private toNumeric(value: any): number | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const parsed = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isNaN(parsed) ? null : parsed;
  }

  /**
   * Kolom `*_nobukti` yang punya FOREIGN KEY ke tabel buktinya masing-masing.
   *
   * Default kolomnya di database adalah '' — dan '' bukan nobukti yang sah,
   * jadi begitu nilainya undefined knex menulis `DEFAULT` dan insert ditolak
   * FK_penerimaandetail_penerimaanemklheader_nobukti. Kolomnya nullable dan FK
   * mengizinkan NULL, jadi kosong harus dipetakan ke NULL secara eksplisit.
   */
  private toNullableRef(value: any): string | null {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    return trimmed === '' ? null : trimmed;
  }

  /**
   * Upsert rincian satu bukti.
   *
   * Rewrite Postgres: TANPA temp table + OPENJSON. OPENJSON adalah fungsi SQL
   * Server (tak ada di PG) dan `##temp_` adalah temp table global bergaya
   * MSSQL, jadi versi lama tidak pernah bisa jalan di Postgres. Upsert langsung
   * dari array JS: update per-baris existing, hapus baris yang tak dikirim
   * (whereNotIn), insert baris baru dgn withUuidV7.
   *
   * `scopeColumn` memisahkan dua pemakaian yang dulu ditulis sebagai dua method
   * kembar: dari PenerimaanheaderService lingkupnya `penerimaan_id`, dari
   * pengembalian kas gantung lingkupnya `pengembaliankasgantung_nobukti`.
   */
  private async upsertDetails(
    details: any[],
    scopeColumn: 'penerimaan_id' | 'pengembaliankasgantung_nobukti',
    scopeValue: any,
    postingdari: string,
    trx: any,
  ) {
    const time = this.utilsService.getTime();
    const logData: any[] = [];

    if (!details || details.length === 0) {
      await trx(this.tableName).delete().where(scopeColumn, scopeValue);
      return null;
    }

    const existingRows: any[] = []; // baris dgn id nyata (bukan '0'/kosong)
    const newRows: any[] = [];

    for (const data of details) {
      data.nominal = this.toNumeric(data.nominal);
      const isNew = !data.id || String(data.id) === '0';

      if (!isNew) {
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

    // nobukti & coa sengaja TIDAK ikut di-update, sama seperti perilaku lama
    // (UPDATE JOIN meng-set keduanya ke nilainya sendiri).
    // pengembaliankasgantung_nobukti hanya boleh ditulis dari jalur pengembalian
    // kas gantung; dari jalur penerimaan nilainya dipertahankan.
    const fromKasGantung = scopeColumn === 'pengembaliankasgantung_nobukti';
    let updatedData: any = null;
    for (const row of existingRows) {
      const res = await trx(this.tableName)
        .where('id', row.id)
        .update({
          keterangan: row.keterangan ?? null,
          nominal: row.nominal,
          transaksibiaya_nobukti: this.toNullableRef(
            row.transaksibiaya_nobukti,
          ),
          transaksilain_nobukti: this.toNullableRef(row.transaksilain_nobukti),
          pengeluaranemklheader_nobukti: this.toNullableRef(
            row.pengeluaranemklheader_nobukti,
          ),
          penerimaanemklheader_nobukti: this.toNullableRef(
            row.penerimaanemklheader_nobukti,
          ),
          ...(fromKasGantung
            ? {
                // NOT NULL di skema, jadi '' (bukan NULL) yang jadi penanda
                // "tidak terkait pengembalian kas gantung".
                pengembaliankasgantung_nobukti:
                  row.pengembaliankasgantung_nobukti ?? '',
              }
            : {}),
          info: row.info ?? null,
          modifiedby: row.modifiedby ?? '',
          penerimaan_id:
            row.penerimaan_id ?? (fromKasGantung ? null : scopeValue),
          created_at: row.created_at,
          updated_at: row.updated_at,
        })
        .returning('*');
      if (res && res[0]) updatedData = res[0];
    }

    // Baris di DB dalam lingkup ini yang tak dikirim lagi -> log DELETE, hapus.
    const incomingIds = existingRows.map((r) => r.id);
    const getDeleted = await trx(this.tableName)
      .where(scopeColumn, scopeValue)
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
      .where(scopeColumn, scopeValue)
      .modify((qb: any) => {
        if (incomingIds.length) qb.whereNotIn('id', incomingIds);
      })
      .del();

    let insertedData: any = null;
    if (newRows.length > 0) {
      // Setiap kolom ditulis EKSPLISIT (termasuk yang bernilai null). Kalau ada
      // yang dibiarkan undefined, knex menulis `DEFAULT` dan Postgres mengisi
      // dengan default kolomnya — '' untuk kolom *_nobukti — yang lalu ditolak
      // foreign key-nya.
      const toInsert = newRows.map((r: any) => ({
        nobukti: r.nobukti ?? '',
        coa: r.coa ?? null,
        keterangan: r.keterangan ?? null,
        nominal: r.nominal,
        transaksibiaya_nobukti: this.toNullableRef(r.transaksibiaya_nobukti),
        transaksilain_nobukti: this.toNullableRef(r.transaksilain_nobukti),
        pengeluaranemklheader_nobukti: this.toNullableRef(
          r.pengeluaranemklheader_nobukti,
        ),
        penerimaanemklheader_nobukti: this.toNullableRef(
          r.penerimaanemklheader_nobukti,
        ),
        // NOT NULL di skema, jadi penanda "tidak ada" di sini adalah '',
        // bukan NULL seperti kolom *_nobukti lainnya.
        pengembaliankasgantung_nobukti:
          r.pengembaliankasgantung_nobukti ??
          (fromKasGantung ? scopeValue : ''),
        info: r.info ?? null,
        modifiedby: r.modifiedby ?? '',
        penerimaan_id: r.penerimaan_id ?? (fromKasGantung ? null : scopeValue),
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
        postingdari,
        idtrans: scopeValue,
        nobuktitrans: scopeValue,
        aksi: 'EDIT',
        datajson: JSON.stringify(finalData),
        modifiedby: details[0].modifiedby || 'unknown',
      },
      trx,
    );

    return updatedData || insertedData;
  }

  async create(details: any, id: any = 0, trx: any = null) {
    return this.upsertDetails(
      details,
      'penerimaan_id',
      id,
      'PENERIMAAN HEADER',
      trx,
    );
  }

  async updateByPengembalianKasGantung(
    details: any,
    id: any = 0,
    trx: any = null,
  ) {
    return this.upsertDetails(
      details,
      'pengembaliankasgantung_nobukti',
      id,
      'PENGEMBALIAN KAS GANTUNG HEADER',
      trx,
    );
  }

  /**
   * Filter + search, dipakai bersama oleh query COUNT dan query DATA supaya
   * total & halaman selalu konsisten. Semua kolom dirujuk lewat alias `p` yang
   * menunjuk ke view (coa_text sudah jadi kolom view, bukan hasil JOIN ad-hoc).
   */
  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    // nobukti & pengembaliankasgantung_nobukti diurus terpisah (exact match)
    // oleh pemanggil.
    const excludeSearchKeys = [
      'penerimaan_id',
      'coa',
      'nobukti',
      'pengembaliankasgantung_nobukti',
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
          if (['created_at', 'updated_at'].includes(field)) {
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

      // Lingkup baris: satu bukti, dan opsional satu pengembalian kas gantung.
      const applyScope = (qb: any) => {
        qb.where('p.nobukti', safeFilters.nobukti);
        if (safeFilters.pengembaliankasgantung_nobukti) {
          qb.where(
            'p.pengembaliankasgantung_nobukti',
            safeFilters.pengembaliankasgantung_nobukti,
          );
        }
      };

      // COUNT dari view, bukan tabel base: filter grid boleh menyentuh coa_text
      // — kolom turunan yang hanya ada di view — sehingga count dari base akan
      // meleset saat filter itu aktif.
      const countResult = await trx(`${this.viewName} as p`)
        .count('p.id as total')
        .modify(applyScope)
        .modify((qb: any) => this.applyFilters(qb, safeFilters, search))
        .first();
      const total = Number(countResult?.total ?? 0);

      const query = trx(`${this.viewName} as p`)
        .select(
          'p.id',
          'p.penerimaan_id',
          'p.nobukti',
          'p.coa',
          'p.coa_text',
          'p.keterangan',
          'p.nominal',
          'p.transaksibiaya_nobukti',
          'p.transaksilain_nobukti',
          'p.pengeluaranemklheader_nobukti',
          'p.penerimaanemklheader_nobukti',
          'p.pengembaliankasgantung_nobukti',
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
        .modify(applyScope)
        .modify((qb: any) => this.applyFilters(qb, safeFilters, search));

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
      // seluruh detail satu bukti sekaligus (FormPenerimaan, total nominal di
      // laporan, exportToExcel di PenerimaanheaderService).
      if (Number(limit) > 0) {
        query.offset(offset).limit(Number(limit));
      }

      const data = await query;

      const totalPages =
        Number(limit) > 0 ? Math.ceil(total / Number(limit)) : 1;
      const responseType = total > 500 ? 'json' : 'local';

      if (!data.length) {
        this.logger.warn('No Data found');
      }

      return {
        status: data.length > 0,
        message:
          data.length > 0
            ? 'Penerimaan Detail data fetched successfully'
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
      console.error('Error in findAll Penerimaan Detail', error);
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} penerimaandetail`;
  }

  update(id: string, updatePenerimaandetailDto: UpdatePenerimaandetailDto) {
    return `This action updates a #${id} penerimaandetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} penerimaandetail`;
  }
}
