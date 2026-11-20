import { Injectable, Logger } from '@nestjs/common';
import { CreateJurnalumumdetailDto } from './dto/create-jurnalumumdetail.dto';
import { UpdateJurnalumumdetailDto } from './dto/update-jurnalumumdetail.dto';
import { withUuidV7, tandatanya, UtilsService } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { filter } from 'rxjs';

@Injectable()
export class JurnalumumdetailService {
  private readonly tableName = 'jurnalumumdetail';
  private readonly viewName = 'vjurnalumumdetail';
  // Kolom yang ikut disapu kotak SEARCH di grid = kolom yang tampil di grid.
  private static readonly SEARCHABLE_COLUMNS = [
    'tglbukti',
    'keterangan',
    'coa_nama',
    'nominaldebet',
    'nominalkredit',
    'modifiedby',
    'created_at',
    'updated_at',
  ];
  private static readonly FILTERABLE_COLUMNS = new Set([
    ...JurnalumumdetailService.SEARCHABLE_COLUMNS,
    'coa',
    'keterangancoa',
    'nominal',
    'info',
  ]);
  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  private readonly logger = new Logger(JurnalumumdetailService.name);
  /**
   * vjurnalumumdetail memangkas barisnya sendiri lewat `tas.nobukti`, jadi
   * filter per-bukti sudah diterapkan sebelum LEFT JOIN akunpusat.
   * `set_config(..., true)` hanya hidup selama transaksi — findAll tetap
   * memasang WHERE nobukti eksplisit untuk jalur tanpa trx (report/export).
   */
  private async setSessionContext(
    trx: any,
    filters: Record<string, any>,
  ): Promise<void> {
    if (filters?.nobukti) {
      await trx.raw(`SELECT set_config('tas.nobukti', ?, true)`, [
        String(filters.nobukti),
      ]);
    }
  }
  async create(details: any, id: any = 0, trx: any = null) {
    // Rewrite Postgres: TANPA temp table + OPENJSON (OPENJSON = fungsi SQL
    // Server, tak ada di PG; jsonExtract memakai jsonb_path_query yang
    // mengembalikan jsonb ber-quote). Upsert langsung dari array JS: update
    // per-baris, hapus yang tak dikirim, insert baru dgn withUuidV7.
    const time = this.utilsService.getTime();
    const logData: any[] = [];

    if (details.length === 0) {
      await trx(this.tableName).delete().where('jurnalumum_id', id);
      return;
    }

    const existingRows: any[] = []; // baris dgn id nyata (bukan '0'/kosong)
    const newRows: any[] = [];

    for (const data of details) {
      const isNew = !data.id || String(data.id) === '0';
      if (!isNew) {
        // Pembanding diambil dari TABEL, bukan view: view memformat
        // tglbukti/created_at/updated_at jadi teks 'DD-MM-YYYY' dan meng-ABS
        // nominal, sehingga created_at hasil bacaan itu ditulis balik ke kolom
        // timestamp dalam format yang ditolak Postgres.
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

    // UPDATE baris existing. coa/nobukti/tglbukti IKUT diubah: user bisa
    // mengganti COA pada baris yang sudah ada, dan nobukti/tglbukti detail harus
    // mengikuti headernya. Kolom yang tidak dikirim pemanggil dibiarkan apa
    // adanya supaya tidak menimpa nilai lama dengan undefined.
    let updatedData: any = null;
    for (const row of existingRows) {
      const payload: Record<string, any> = {
        keterangan: row.keterangan,
        nominal: row.nominal,
        info: row.info,
        modifiedby: row.modifiedby,
        jurnalumum_id: row.jurnalumum_id ?? id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      if (row.coa !== undefined) payload.coa = row.coa;
      if (row.nobukti !== undefined) payload.nobukti = row.nobukti;
      if (row.tglbukti !== undefined) payload.tglbukti = row.tglbukti;

      const res = await trx(this.tableName)
        .where('id', row.id)
        .update(payload)
        .returning('*');
      if (res && res[0]) updatedData = res[0];
    }

    // Baris di DB (jurnalumum_id = id) yang tak dikirim lagi → log DELETE, hapus.
    const incomingIds = existingRows.map((r) => r.id);
    const getDeleted = await trx(this.tableName)
      .where('jurnalumum_id', id)
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
      .where('jurnalumum_id', id)
      .modify((qb: any) => {
        if (incomingIds.length) qb.whereNotIn('id', incomingIds);
      })
      .del();

    // INSERT baris baru dgn uuid v7.
    let insertedData: any = null;
    if (newRows.length > 0) {
      const toInsert = newRows.map((r: any) => ({
        nobukti: r.nobukti,
        tglbukti: r.tglbukti,
        coa: r.coa,
        keterangan: r.keterangan,
        nominal: r.nominal,
        info: r.info,
        modifiedby: r.modifiedby,
        jurnalumum_id: id,
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
        postingdari: 'JURNAL UMUM DETAIL',
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

  // Ekspresi SQL per kolom grid, mengikuti bentuk kolom di vjurnalumumdetail:
  // tglbukti/created_at/updated_at sudah keluar sebagai TEKS ter-format dari
  // view (TO_CHAR lagi di sini = error to_char(text, unknown)), coa_nama datang
  // dari akunpusat, dan nominaldebet/nominalkredit sudah dipecah view dari
  // tanda nominal — nominal-nya sendiri sudah ABS. Filter, search, dan sort
  // harus memakai ekspresi yang sama dengan yang di-select supaya hasilnya
  // cocok dengan yang dilihat user.
  private filterExpression(trx: any, key: string) {
    switch (key) {
      case 'coa_nama':
      case 'keterangancoa':
        return trx.raw('p.coa_nama');
      case 'nominaldebet':
      case 'nominalkredit':
      case 'nominal':
        return trx.raw(`p.${key}::text`);
      default:
        return trx.raw(`p.${key}`);
    }
  }

  // Sort dari grid dipakai sebagai primary order, jadi kolom tanggal yang di
  // view sudah jadi teks dikembalikan ke tipe aslinya — tanpa itu urutannya
  // alfabetis ('02-01-2026' dianggap sebelum '10-12-2025').
  private sortExpression(trx: any, key: string) {
    switch (key) {
      case 'tglbukti':
        return trx.raw("TO_DATE(p.tglbukti, 'DD-MM-YYYY')");
      case 'created_at':
      case 'updated_at':
        return trx.raw(`TO_TIMESTAMP(p.${key}, 'DD-MM-YYYY HH24:MI:SS')`);
      case 'coa_nama':
      case 'keterangancoa':
        return trx.raw('p.coa_nama');
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
      const sanitized = String(search).replace(/\[/g, '[[]').trim();

      qb.where((builder: any) => {
        JurnalumumdetailService.SEARCHABLE_COLUMNS.forEach((field) => {
          builder.orWhere(
            this.filterExpression(trx, field),
            'ilike',
            `%${sanitized}%`,
          );
        });
      });
    }

    for (const [key, value] of Object.entries(filters || {})) {
      // nobukti diurus terpisah (exact match) oleh pemanggil; key di luar
      // whitelist (consignee_id, tglDari/tglSampai, *_nobukti) bukan kolom
      // tabel ini dan akan membuat query gagal kalau diteruskan apa adanya.
      if (!JurnalumumdetailService.FILTERABLE_COLUMNS.has(key)) continue;
      if (value === null || value === undefined || value === '') continue;

      const sanitized = String(value).replace(/\[/g, '[[]');
      qb.andWhere(this.filterExpression(trx, key), 'ilike', `%${sanitized}%`);
    }
  }

  async findAll(
    { search, filters, pagination, sort }: FindAllParams,
    trx: any,
  ) {
    const { page = 1, limit = 0 } = pagination ?? {};
    await this.setSessionContext(trx, filters || {});

    if (!filters?.nobukti) {
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

      // set_config di atas sudah memangkas view, tapi WHERE eksplisit tetap
      // dipasang supaya rincian bukti lain tidak bocor kalau session context
      // tidak berlaku — pemanggil tanpa transaksi (cetak/export bukti) memang
      // begitu, karena set_config(..., true) hanya hidup selama transaksi.
      const scoped = (qb: any) => {
        qb.where('p.nobukti', String(safeFilters.nobukti));
        this.applyFilters(trx, qb, safeFilters, search);
      };

      const countResult = await trx(`${this.viewName} as p`)
        .modify(scoped)
        .count('p.id as total')
        .first();
      const total = Number(countResult?.total ?? 0);

      const query = trx
        .from(trx.raw(`${this.viewName} as p`))
        .select(
          'p.id',
          'p.jurnalumum_id',
          'p.tglbukti',
          'p.nobukti',
          'p.coa',
          'p.keterangan',
          'p.coa_nama',
          'p.nominaldebet',
          'p.nominalkredit',
          'p.nominal',
          'p.info',
          'p.modifiedby',
          'p.link',
          'p.created_at',
          'p.updated_at',
        );

      query.modify(scoped);

      // Urutan HARUS deterministik: tanpa itu offset/limit bisa memulangkan
      // baris yang sama di dua halaman berbeda (atau melewatkan baris) saat
      // grid menggeser window. Sort dari grid jadi primary, created_at lalu id
      // (PK, unik) sebagai tiebreaker supaya urutan total dan stabil.
      const sortBy = sort?.sortBy || 'nobukti';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';

      query.orderBy(this.sortExpression(trx, sortBy), sortDirection);
      if (sortBy !== 'created_at') {
        query.orderBy(this.sortExpression(trx, 'created_at'), 'asc');
      }
      if (sortBy !== 'id') {
        query.orderBy('p.id', 'asc');
      }

      // limit 0/undefined = ambil semua. Dipakai pemanggil non-grid yang butuh
      // seluruh detail satu bukti sekaligus (FormJurnalUmum, exportToExcel).
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
            ? 'Jurnal Umum Detail data fetched successfully'
            : 'No data found',
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
      console.error('Error in findAll Kas Gantung Detail', error);
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} jurnalumumdetail`;
  }

  update(id: string, updateJurnalumumdetailDto: UpdateJurnalumumdetailDto) {
    return `This action updates a #${id} jurnalumumdetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} jurnalumumdetail`;
  }
}
