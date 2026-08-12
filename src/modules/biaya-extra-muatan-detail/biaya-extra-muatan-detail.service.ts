import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UpdateBiayaExtraMuatanDetailDto } from './dto/update-biaya-extra-muatan-detail.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { withUuidV7, UtilsService } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';

@Injectable()
export class BiayaExtraMuatanDetailService {
  private readonly logger = new Logger(BiayaExtraMuatanDetailService.name);

  private readonly tableName = 'biayaextramuatandetail';
  private readonly viewName = 'vbiayaextramuatandetail';
  private readonly viewNameOrderan = 'vbiayaextramuatandetailorderan';
  private readonly viewNameByJob = 'vbiayaextrabyjob';

  // Kolom yang ikut disapu kotak SEARCH di grid = kolom yang tampil di grid.
  private static readonly SEARCHABLE_COLUMNS = [
    'nobukti',
    'orderanmuatan_nobukti',
    'estimasi',
    'nominal',
    'nominaltagih',
    'keterangan',
    'statustagih_text',
    'groupbiayaextra_text',
    'modifiedby',
    'created_at',
    'updated_at',
  ];
  private static readonly FILTERABLE_COLUMNS = new Set([
    ...BiayaExtraMuatanDetailService.SEARCHABLE_COLUMNS,
    'statustagih',
    'groupbiayaextra_id',
    'info',
  ]);

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}

  /**
   * View memangkas barisnya sendiri lewat `tas.biayaextra_id` (transaction
   * local), jadi filter per-header sudah diterapkan sebelum join — sama seperti
   * `tas.nobukti` di vjurnalumumdetail.
   */
  private async setSessionContext(
    trx: any,
    filters: Record<string, any>,
  ): Promise<void> {
    if (filters?.biayaextra_id) {
      await trx.raw(`SELECT set_config('tas.biayaextra_id', ?, true)`, [
        String(filters.biayaextra_id),
      ]);
    }
  }

  async create(details: any, id: any = 0, trx: any = null) {
    // Rewrite Postgres: TANPA temp table + OPENJSON. OPENJSON adalah fungsi SQL
    // Server (tak ada di PG -> "function openjson(unknown) does not exist"), dan
    // jsonExtract memakai jsonb_path_query yang mengembalikan jsonb ber-quote
    // (korupsi nilai). Upsert langsung dari array JS: update per-baris existing,
    // hapus baris yang tak dikirim (whereNotIn), insert baris baru dgn
    // withUuidV7. Pola ini sama dengan jurnalumumdetail.service.ts.
    try {
      let insertedData: any = null;
      let updatedData: any = null;
      const logData: any[] = [];
      const time = this.utilsService.getTime();

      // estimasi/nominal/nominaltagih bertipe money->numeric. Grid mengirimnya
      // lewat InputCurrency sebagai string ter-format ("100,000.00"); koma
      // ribuan ditolak PG dengan 22P02 invalid input syntax for type numeric.
      // Kosong -> null (kolom nullable).
      const toNumeric = (value: any): number | null => {
        if (value === null || value === undefined || value === '') return null;
        if (typeof value === 'number')
          return Number.isFinite(value) ? value : null;
        const parsed = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
        return Number.isNaN(parsed) ? null : parsed;
      };

      if (details.length === 0) {
        await trx(this.tableName).delete().where('biayaextra_id', id);
        return;
      }

      const existingRows: any[] = []; // baris dgn id nyata (bukan '0'/kosong)
      const newRows: any[] = [];

      for (const data of details) {
        // Uppercase hanya kolom teks manusiawi. id (PK), biayaextra_id/
        // groupbiayaextra_id (FK), status*, dan *_nobukti adalah UUID/kunci
        // bertipe text (case-sensitive); blanket uppercase meng-corrupt id.
        ['keterangan'].forEach((field) => {
          if (typeof data[field] === 'string') {
            data[field] = data[field].toUpperCase();
          }
        });

        data.estimasi = toNumeric(data.estimasi);
        data.nominal = toNumeric(data.nominal);
        data.nominaltagih = toNumeric(data.nominaltagih);

        const isNew = !data.id || String(data.id) === '0';
        if (!isNew) {
          // Dibaca dari tabel dasar, bukan view: view memformat created_at/
          // updated_at jadi teks sehingga hasChanges selalu true.
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
      for (const row of existingRows) {
        const res = await trx(this.tableName)
          .where('id', row.id)
          .update({
            nobukti: row.nobukti,
            biayaextra_id: row.biayaextra_id ?? id,
            orderanmuatan_nobukti: row.orderanmuatan_nobukti,
            estimasi: row.estimasi,
            nominal: row.nominal,
            statustagih: row.statustagih,
            nominaltagih: row.nominaltagih,
            keterangan: row.keterangan,
            groupbiayaextra_id: row.groupbiayaextra_id,
            info: row.info,
            modifiedby: row.modifiedby,
            created_at: row.created_at,
            updated_at: row.updated_at,
          })
          .returning('*');
        if (res && res[0]) updatedData = res[0];
      }

      // Baris di DB (biayaextra_id = id) yang tak dikirim lagi -> log DELETE,
      // lalu hapus.
      const incomingIds = existingRows.map((r) => r.id);
      const getDeleted = await trx(this.tableName)
        .where('biayaextra_id', id)
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
        .where('biayaextra_id', id)
        .modify((qb: any) => {
          if (incomingIds.length) qb.whereNotIn('id', incomingIds);
        })
        .del();

      // INSERT baris baru dgn uuid v7.
      if (newRows.length > 0) {
        const toInsert = newRows.map((r: any) => ({
          nobukti: r.nobukti,
          biayaextra_id: r.biayaextra_id ?? id,
          orderanmuatan_nobukti: r.orderanmuatan_nobukti,
          estimasi: r.estimasi,
          nominal: r.nominal,
          statustagih: r.statustagih,
          nominaltagih: r.nominaltagih,
          keterangan: r.keterangan,
          groupbiayaextra_id: r.groupbiayaextra_id,
          info: r.info,
          modifiedby: r.modifiedby,
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
          postingdari: 'BIAYA EXTRA MUATAN DETAIL',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(finalData),
          modifiedby: details[0].modifiedby || 'unknown',
        },
        trx,
      );

      return updatedData || insertedData;
    } catch (error) {
      console.error(
        'Error process creating biaya extra muatan detail in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process creating biaya extra muatan detail in service',
      );
    }
  }

  // Ekspresi SQL per kolom grid. Filter, search, dan sort harus memakai ekspresi
  // yang sama dengan yang di-select supaya hasilnya cocok dengan yang dilihat
  // user. created_at/updated_at sudah berupa teks DD-MM-YYYY di view.
  private filterExpression(trx: any, key: string) {
    switch (key) {
      case 'estimasi':
      case 'nominal':
      case 'nominaltagih':
        return trx.raw(`p.${key}::text`);
      default:
        return trx.raw(`p.${key}`);
    }
  }

  // Sort dari grid dipakai sebagai primary order, jadi ekspresinya harus
  // ekspresi asli (bukan ::text) supaya numerik terurut benar.
  private sortExpression(trx: any, key: string) {
    switch (key) {
      case 'statustagih':
      case 'statustagih_nama':
        return trx.raw('p.statustagih_text');
      case 'groupbiayaextra_nama':
        return trx.raw('p.groupbiayaextra_text');
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
        BiayaExtraMuatanDetailService.SEARCHABLE_COLUMNS.forEach((field) => {
          builder.orWhere(
            this.filterExpression(trx, field),
            'ilike',
            `%${sanitized}%`,
          );
        });
      });
    }

    for (const [key, value] of Object.entries(filters || {})) {
      // biayaextra_id diurus terpisah (exact match) oleh pemanggil; key di luar
      // whitelist bukan kolom view ini dan akan membuat query gagal kalau
      // diteruskan apa adanya.
      if (!BiayaExtraMuatanDetailService.FILTERABLE_COLUMNS.has(key)) continue;
      if (value === null || value === undefined || value === '') continue;

      const sanitized = String(value).replace(/\[/g, '[[]');

      // FilterOptions mengirim parameter.id, bukan teks statusnya.
      if (key === 'statustagih_text') {
        qb.andWhere('p.statustagih', sanitized);
        continue;
      }

      qb.andWhere(this.filterExpression(trx, key), 'ilike', `%${sanitized}%`);
    }
  }

  async findAll(
    { search, filters, pagination, sort }: FindAllParams,
    trx: any,
  ) {
    const { page = 1, limit = 0 } = pagination ?? {};
    const safeFilters = filters || {};
    await this.setSessionContext(trx, safeFilters);

    if (!safeFilters.biayaextra_id) {
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
      // set_config di atas sudah memangkas view, tapi WHERE eksplisit tetap
      // dipasang supaya kebocoran ke header lain tidak mungkin terjadi kalau
      // session context gagal ter-set.
      const scoped = (qb: any) => {
        qb.where('p.biayaextra_id', safeFilters.biayaextra_id);
        this.applyFilters(trx, qb, safeFilters, search);
      };

      const countResult = await trx(`${this.viewName} as p`)
        .modify(scoped)
        .count('p.id as total')
        .first();
      const total = Number(countResult?.total ?? 0);

      const query = trx(`${this.viewName} as p`)
        .select(
          'p.id',
          'p.biayaextra_id',
          'p.nobukti',
          'p.orderanmuatan_nobukti',
          'p.estimasi',
          'p.nominal',
          'p.statustagih',
          'p.statustagih_text as statustagih_nama',
          'p.statustagih_text',
          'p.statustagih_memo',
          'p.nominaltagih',
          'p.keterangan',
          'p.groupbiayaextra_id',
          'p.groupbiayaextra_text as groupbiayaextra_nama',
          'p.info',
          'p.modifiedby',
          'p.created_at',
          'p.updated_at',
          'p.link',
        )
        .modify(scoped);

      // Urutan HARUS deterministik: tanpa itu offset/limit bisa memulangkan
      // baris yang sama di dua halaman berbeda (atau melewatkan baris) saat
      // grid menggeser window. Sort dari grid jadi primary, created_at lalu id
      // (PK, unik) sebagai tiebreaker supaya urutan total dan stabil.
      const sortBy = sort?.sortBy || 'id';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';

      query.orderBy(this.sortExpression(trx, sortBy), sortDirection);
      if (sortBy !== 'id') {
        query.orderBy('p.id', 'asc');
      }

      // limit 0/undefined = ambil semua. Dipakai pemanggil non-grid yang butuh
      // seluruh detail satu bukti sekaligus (FormBiayaExtraHeader, findOne
      // header untuk export/cetak).
      if (Number(limit) > 0) {
        query.offset((Number(page) - 1) * Number(limit)).limit(Number(limit));
      }

      const data = await query;
      const totalPages =
        Number(limit) > 0 ? Math.ceil(total / Number(limit)) : 1;

      return {
        status: data.length > 0,
        message:
          data.length > 0
            ? 'Biaya Extra Muatan Detail data fetched successfully'
            : 'No data found',
        data,
        total,
        pagination: {
          currentPage: Number(page),
          totalPages,
          totalItems: total,
          itemsPerPage: Number(limit),
        },
      };
    } catch (error) {
      console.error('Error in findAll Biaya Extra Muatan Detail', error);
      throw new Error(error);
    }
  }

  async delete(id: string, trx: any, modifiedby: any) {
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
          postingdari: 'DELETE BIAYA EXTRA MUATAN DETAIL',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: String(modifiedby ?? 'unknown').toUpperCase(),
        },
        trx,
      );

      return { status: 200, message: 'Data deleted successfully', deletedData };
    } catch (error) {
      console.log('Error deleting biaya extra muatan detail:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete data biaya extra muatan detail in service',
      );
    }
  }

  /**
   * Rincian orderan (container/seal/shipper) di balik tiap baris detail —
   * dipakai FormBiayaHeader untuk menarik biaya extra ke dalam biaya header.
   */
  async findOne(id: string, trx: any = null) {
    try {
      // View memangkas barisnya sendiri lewat tas.biayaextra_id, sama seperti
      // findAll; WHERE eksplisit tetap dipasang sebagai jaring pengaman.
      await this.setSessionContext(trx, { biayaextra_id: id });

      const data = await trx(`${this.viewNameOrderan} as p`)
        .select([
          'p.nobukti',
          'p.biayaextra_id',
          'p.orderan_nobukti',
          'p.estimasi',
          'p.tglbukti',
          'p.orderan_id',
          'p.nocontainer',
          'p.noseal',
          'p.lokasistuffing_nama',
          'p.shipper_nama',
          'p.container_nama',
        ])
        .where('p.biayaextra_id', id);

      return data;
    } catch (error) {
      console.error('Error fetching biaya extra muatan detail by id:', error);
      throw new Error('Failed to fetch data biaya extra muatan detail by id');
    }
  }

  // Key query string lookup -> kolom vbiayaextrabyjob. Key di luar peta ini
  // diabaikan: sebelumnya key apa pun diinterpolasi jadi `detail.<key>`,
  // sehingga satu parameter nyasar dari LookUp (page/limit/sortBy) langsung
  // menjatuhkan query dengan "column does not exist".
  private static readonly BY_JOB_FILTERS: Record<
    string,
    { column: string; exact?: boolean }
  > = {
    jenisOrderan: { column: 'p.jenisorder_id', exact: true },
    biayaemkl_id: { column: 'p.biayaemkl_id', exact: true },
    job: { column: 'p.orderanmuatan_nobukti' },
    nobukti: { column: 'p.nobukti' },
    keterangan: { column: 'p.keterangan' },
  };

  async biayaExraByJob(filters: any, trx: any = null) {
    try {
      const query = trx(`${this.viewNameByJob} as p`).select([
        'p.id',
        'p.nobukti',
        'p.biayaextra_id',
        'p.estimasi',
        'p.nominal',
      ]);

      for (const [key, value] of Object.entries(filters || {})) {
        const mapped = BiayaExtraMuatanDetailService.BY_JOB_FILTERS[key];
        if (!mapped || !value) continue;

        const sanitized = String(value).replace(/\[/g, '[[]');
        if (mapped.exact) {
          query.andWhere(mapped.column, '=', sanitized);
        } else {
          query.andWhere(mapped.column, 'ilike', `%${sanitized}%`);
        }
      }

      const data = await query;
      return data;
    } catch (error) {
      console.error('Error fetching biaya extra by job:', error);
      throw new Error('Failed to fetch data biaya extra by job');
    }
  }

  update(
    id: string,
    updateBiayaExtraMuatanDetailDto: UpdateBiayaExtraMuatanDetailDto,
  ) {
    return `This action updates a #${id} biayaExtraMuatanDetail`;
  }
}
