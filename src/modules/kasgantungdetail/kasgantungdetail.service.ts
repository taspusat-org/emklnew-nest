import { Injectable, Logger } from '@nestjs/common';
import { UpdateKasgantungdetailDto } from './dto/update-kasgantungdetail.dto';
import { withUuidV7, tandatanya, UtilsService } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class KasgantungdetailService {
  private readonly tableName = 'kasgantungdetail';
  private readonly viewName = 'vkasgantungdetail';
  // Kolom yang ikut disapu kotak SEARCH di grid = kolom yang tampil di grid.
  private static readonly SEARCHABLE_COLUMNS = [
    'keterangan',
    'nominal',
    'modifiedby',
    'created_at',
    'updated_at',
  ];
  private static readonly FILTERABLE_COLUMNS = new Set([
    ...KasgantungdetailService.SEARCHABLE_COLUMNS,
    'info',
    'pengeluarandetail_id',
  ]);
  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  private readonly logger = new Logger(KasgantungdetailService.name);
  private async setSessionContext(
    trx: any,
    filters: Record<string, any>,
  ): Promise<void> {
    if (filters?.nobukti) {
      await trx.raw(`SELECT set_config('tas.nobukti', ?, true)`, [
        filters.nobukti,
      ]);
    }
  }
  async create(details: any, id: any = 0, trx: any = null) {
    const time = this.utilsService.getTime();
    const logData: any[] = [];

    if (details.length === 0) {
      await trx(this.tableName).delete().where('kasgantung_id', id);
      return;
    }

    const existingRows: any[] = []; // baris dgn id nyata (bukan '0'/kosong)
    const newRows: any[] = [];

    for (const data of details) {
      const isNew = !data.id || String(data.id) === '0';
      if (!isNew) {
        const existingData = await trx(this.viewName)
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

    // UPDATE baris existing. nobukti sengaja TIDAK diubah agar sama dgn
    // perilaku lama (UPDATE JOIN meng-set kolomnya ke nilai sendiri).
    let updatedData: any = null;
    for (const row of existingRows) {
      const res = await trx(this.tableName)
        .where('id', row.id)
        .update({
          keterangan: row.keterangan,
          nominal: row.nominal,
          info: row.info,
          modifiedby: row.modifiedby,
          pengeluarandetail_id: row.pengeluarandetail_id ?? null,
          kasgantung_id: row.kasgantung_id ?? id,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })
        .returning('*');
      if (res && res[0]) updatedData = res[0];
    }

    // Baris di DB (kasgantung_id = id) yang tak dikirim lagi → log DELETE, hapus.
    const incomingIds = existingRows.map((r) => r.id);
    const getDeleted = await trx(this.tableName)
      .where('kasgantung_id', id)
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
      .where('kasgantung_id', id)
      .modify((qb: any) => {
        if (incomingIds.length) qb.whereNotIn('id', incomingIds);
      })
      .del();

    // INSERT baris baru dgn uuid v7.
    let insertedData: any = null;
    if (newRows.length > 0) {
      const toInsert = newRows.map((r: any) => ({
        nobukti: r.nobukti,
        keterangan: r.keterangan,
        nominal: r.nominal,
        info: r.info,
        modifiedby: r.modifiedby,
        pengeluarandetail_id: r.pengeluarandetail_id ?? null,
        kasgantung_id: id,
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
        postingdari: 'KAS GANTUNG DETAIL',
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

  // Ekspresi SQL per kolom grid. Filter, search, dan sort harus memakai
  // ekspresi yang sama dengan yang di-select supaya hasilnya cocok dengan yang
  // dilihat user.
  private filterExpression(trx: any, key: string) {
    switch (key) {
      case 'created_at':
      case 'updated_at':
        return trx.raw(`TO_CHAR(p.${key}, 'DD-MM-YYYY HH24:MI:SS')`);
      case 'nominal':
        return trx.raw('p.nominal::text');
      default:
        return trx.raw(`p.${key}`);
    }
  }

  // Sort dari grid dipakai sebagai primary order, jadi ekspresinya harus
  // ekspresi asli (bukan ::text) supaya numerik/tanggal terurut benar.
  private sortExpression(trx: any, key: string) {
    return trx.raw(`p.${key}`);
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
        KasgantungdetailService.SEARCHABLE_COLUMNS.forEach((field) => {
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
      // whitelist bukan kolom tabel ini dan akan membuat query gagal kalau
      // diteruskan apa adanya.
      if (!KasgantungdetailService.FILTERABLE_COLUMNS.has(key)) continue;
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
    const url = 'kas-gantung';

    try {
      const safeFilters = filters || {};

      const countResult = await trx(`${this.viewName} as p`)
        .where('p.nobukti', safeFilters.nobukti)
        .modify((qb: any) => this.applyFilters(trx, qb, safeFilters, search))
        .count('p.id as total')
        .first();
      const total = Number(countResult?.total ?? 0);

      const query = trx
        .from(trx.raw(`${this.viewName} as p`))
        .select(
          'p.id',
          'p.kasgantung_id',
          'p.nobukti',
          'p.keterangan',
          'p.nominal',
          'p.info',
          'p.modifiedby',
          'p.pengeluarandetail_id',
          'p.link',
          trx.raw(
            "TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
        )
        .where('p.nobukti', safeFilters.nobukti);

      query.modify((qb: any) =>
        this.applyFilters(trx, qb, safeFilters, search),
      );

      // Urutan HARUS deterministik: tanpa itu offset/limit bisa memulangkan
      // baris yang sama di dua halaman berbeda (atau melewatkan baris) saat
      // grid menggeser window. Sort dari grid jadi primary, created_at lalu id
      // (PK, unik) sebagai tiebreaker supaya urutan total dan stabil.
      const sortBy = sort?.sortBy || 'nobukti';
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
      // seluruh detail satu bukti sekaligus (FormKasGantung, exportToExcel).
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
            ? 'Kas Gantung Detail data fetched successfully'
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
    return `This action returns a #${id} kasgantungdetail`;
  }

  update(id: string, updateKasgantungdetailDto: UpdateKasgantungdetailDto) {
    return `This action updates a #${id} kasgantungdetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} kasgantungdetail`;
  }
}
