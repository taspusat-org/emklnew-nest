import { Injectable, Logger } from '@nestjs/common';
import { UpdateHutangdetailDto } from './dto/update-hutangdetail.dto';
// `tandatanya` tidak lagi dipakai: kolom `link` sekarang dibangun di dalam
// view vhutangdetail, bukan di query knex.
import { withUuidV7, UtilsService } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class HutangdetailService {
  private readonly tableName = 'hutangdetail';
  // Baca lewat view (lihat create-vhutangdetail-pg.sql), tulis lewat tabel base
  // — pola yang sama dengan pengeluarandetail (vpengeluarandetail). View sudah
  // memuat coa_text & link sehingga findAll tidak perlu JOIN + membangun tabel
  // temp di tiap request; itu syarat agar windowed pagination (grid menarik 5
  // halaman sekaligus) tetap murah.
  private readonly viewName = 'vhutangdetail';

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}

  private readonly logger = new Logger(HutangdetailService.name);

  /**
   * Kolom tabel hutangdetail (selain `id` yang diisi withUuidV7) — satu-satunya
   * sumber kebenaran untuk INSERT maupun UPDATE, supaya kedua daftar kolom tidak
   * lagi ditulis terpisah dan bisa menyimpang. Key kiriman frontend di luar
   * daftar ini (mis. coa_text, aksi) dibuang.
   */
  private buildDetailRow(
    row: any,
    hutangId: any,
    { withNobukti }: { withNobukti: boolean },
  ): Record<string, any> {
    const data: Record<string, any> = {
      coa: row.coa,
      keterangan: row.keterangan,
      nominal: row.nominal,
      dpp: row.dpp,
      noinvoiceemkl: row.noinvoiceemkl,
      tglinvoiceemkl: row.tglinvoiceemkl,
      nofakturpajakemkl: row.nofakturpajakemkl,
      info: row.info,
      modifiedby: row.modifiedby,
      hutang_id: hutangId,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    // nobukti hanya diisi saat INSERT. Pada UPDATE sengaja tidak disertakan:
    // nomor bukti milik header dan tidak boleh berubah lewat baris detail.
    if (withNobukti) data.nobukti = row.nobukti;

    return data;
  }

  async create(details: any, id: any = 0, trx: any = null) {
    // Rewrite Postgres: TANPA temp table + OPENJSON. OPENJSON adalah fungsi SQL
    // Server (tak ada di PG), dan `##temp_...` adalah sintaks global temp table
    // SQL Server yang di PG cuma jadi nama tabel permanen aneh. Upsert langsung
    // dari array JS: update per-baris existing, hapus baris yang tak dikirim
    // (whereNotIn), insert baris baru dgn withUuidV7.
    const time = this.utilsService.getTime();
    const logData: any[] = [];

    // nominal & dpp bertipe numeric. Grid mengirimnya lewat InputCurrency sebagai
    // string ter-format ("100,000.00"); koma ribuan ditolak PG dengan 22P02
    // invalid input syntax for type numeric. Kosong → null (kolom nullable).
    const toNumeric = (value: any): number | null => {
      if (value === null || value === undefined || value === '') return null;
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      const parsed = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
      return Number.isNaN(parsed) ? null : parsed;
    };

    if (details.length === 0) {
      await trx(this.tableName).delete().where('hutang_id', id);
      return;
    }

    const existingRows: any[] = []; // baris dgn id nyata (bukan '0'/kosong)
    const newRows: any[] = [];

    for (const data of details) {
      data.nominal = toNumeric(data.nominal);
      data.dpp = toNumeric(data.dpp);
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

    // UPDATE baris existing (per baris).
    let updatedData: any = null;
    for (const row of existingRows) {
      const res = await trx(this.tableName)
        .where('id', row.id)
        .update(
          this.buildDetailRow(row, row.hutang_id ?? id, { withNobukti: false }),
        )
        .returning('*');
      if (res && res[0]) updatedData = res[0];
    }

    // Baris di DB (hutang_id = id) yang tak dikirim lagi → log DELETE, hapus.
    const incomingIds = existingRows.map((r) => r.id);
    const getDeleted = await trx(this.tableName)
      .where('hutang_id', id)
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
      .where('hutang_id', id)
      .modify((qb: any) => {
        if (incomingIds.length) qb.whereNotIn('id', incomingIds);
      })
      .del();

    // INSERT baris baru dgn uuid v7.
    let insertedData: any = null;
    if (newRows.length > 0) {
      const toInsert = newRows.map((r: any) =>
        this.buildDetailRow(r, id, { withNobukti: true }),
      );
      insertedData = await trx(this.tableName)
        .insert(await withUuidV7(trx, toInsert))
        .returning('*')
        .then((result: any) => result[0]);
    }

    await this.logTrailService.create(
      {
        namatabel: this.tableName,
        postingdari: 'HUTANG HEADER',
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
   * menunjuk ke view (coa_text sudah jadi kolom view, bukan hasil JOIN ad-hoc).
   */
  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    // nobukti sengaja diurus terpisah (exact match) oleh pemanggil.
    const excludeSearchKeys = ['hutang_id', 'coa', 'nobukti'];

    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );

    if (search) {
      const sanitizedValue = String(search).replace(/\[/g, '[[]').trim();

      qb.where((query: any) => {
        searchFields.forEach((field) => {
          if (['created_at', 'updated_at'].includes(field)) {
            query.orWhereRaw("TO_CHAR(p.??, 'DD-MM-YYYY HH24:MI:SS') ilike ?", [
              field,
              `%${sanitizedValue}%`,
            ]);
          } else if (field === 'tglinvoiceemkl') {
            // Di view kolom ini sudah dinormalkan jadi DATE dan di select
            // diformat 'DD-MM-YYYY'; pakai format yang sama supaya yang dicari
            // = yang tampil di grid.
            query.orWhereRaw("TO_CHAR(p.tglinvoiceemkl, 'DD-MM-YYYY') ilike ?", [
              `%${sanitizedValue}%`,
            ]);
          } else if (field === 'nominal' || field === 'dpp') {
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
        case 'tglinvoiceemkl_dari':
          qb.andWhere('p.tglinvoiceemkl', '>=', sanitizedValue);
          break;
        case 'tglinvoiceemkl_sampai':
          qb.andWhere('p.tglinvoiceemkl', '<=', sanitizedValue);
          break;
        case 'tglinvoiceemkl':
          qb.andWhereRaw("TO_CHAR(p.tglinvoiceemkl, 'DD-MM-YYYY') ilike ?", [
            `%${sanitizedValue}%`,
          ]);
          break;
        case 'created_at':
        case 'updated_at':
          qb.andWhereRaw("TO_CHAR(p.??, 'DD-MM-YYYY HH24:MI:SS') ilike ?", [
            key,
            `%${sanitizedValue}%`,
          ]);
          break;
        case 'nominal':
        case 'dpp':
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

      // COUNT dari view, bukan tabel base: filter grid boleh menyentuh coa_text
      // — kolom turunan yang hanya ada di view — sehingga count dari base akan
      // meleset saat filter itu aktif.
      const countResult = await trx(`${this.viewName} as p`)
        .count('p.id as total')
        .where('p.nobukti', safeFilters.nobukti)
        .modify((qb: any) => this.applyFilters(qb, safeFilters, search))
        .first();
      const total = Number(countResult?.total ?? 0);

      const query = trx(`${this.viewName} as p`)
        .select(
          'p.id',
          'p.hutang_id',
          'p.nobukti',
          'p.coa',
          'p.coa_text',
          'p.keterangan',
          'p.nominal',
          'p.dpp',
          'p.noinvoiceemkl',
          trx.raw("TO_CHAR(p.tglinvoiceemkl, 'DD-MM-YYYY') as tglinvoiceemkl"),
          'p.nofakturpajakemkl',
          'p.info',
          'p.modifiedby',
          trx.raw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'p.link',
        )
        .where('p.nobukti', safeFilters.nobukti);

      query.modify((qb: any) => this.applyFilters(qb, safeFilters, search));

      // Urutan HARUS deterministik: tanpa itu offset/limit bisa memulangkan
      // baris yang sama di dua halaman berbeda (atau melewatkan baris) saat
      // grid menggeser window.
      //
      // Dulu urutannya dipaku ke `created_at desc` lebih dulu sehingga sort dari
      // grid praktis tidak berpengaruh. Lebih buruk: seluruh detail satu bukti
      // di-insert dalam satu batch sehingga created_at-nya identik, jadi urutan
      // akhirnya ditentukan urutan heap Postgres yang berubah tiap ada UPDATE.
      //
      // Sekarang: sortBy dari grid jadi primary, lalu created_at (urutan input
      // antar batch), lalu id (PK, unik) sebagai tiebreaker terakhir supaya
      // urutan dijamin total dan stabil antar request.
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
      // seluruh detail satu bukti sekaligus (FormHutang, total nominal di
      // laporan, exportToExcel di HutangheaderService).
      if (Number(limit) > 0) {
        query.offset(offset).limit(Number(limit));
      }

      const data = await query;

      const totalPages = Number(limit) > 0 ? Math.ceil(total / Number(limit)) : 1;
      const responseType = total > 500 ? 'json' : 'local';

      if (!data.length) {
        this.logger.warn(`No Data found`);
      }

      return {
        status: data.length > 0,
        message:
          data.length > 0
            ? 'Hutang Detail data fetched successfully'
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
      console.error('Error in findAll Hutang Detail', error);
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} hutangdetail`;
  }

  update(id: string, updateHutangdetailDto: UpdateHutangdetailDto) {
    return `This action updates a #${id} hutangdetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} hutangdetail`;
  }
}
