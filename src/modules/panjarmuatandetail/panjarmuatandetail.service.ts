import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { withUuidV7, UtilsService } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';

@Injectable()
export class PanjarmuatandetailService {
  private readonly tableName: string = 'panjarmuatandetail';
  // Baca lewat view (lihat create-vpanjar-pg.sql), tulis lewat tabel base —
  // pola yang sama dengan pengeluarandetail (vpengeluarandetail) dan shipping
  // instruction detail (vshippinginstructiondetail).
  private readonly viewName: string = 'vpanjarmuatandetail';

  private readonly logger = new Logger(PanjarmuatandetailService.name);

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}

  private toNumeric(value: any): number | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const parsed = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isNaN(parsed) ? null : parsed;
  }

  async create(details: any, id: any = 0, trx: any = null) {
    try {
      const time = this.utilsService.getTime();
      const logData: any[] = [];

      if (!details || details.length === 0) {
        await trx(this.tableName).delete().where('panjar_id', id);
        return;
      }

      const existingRows: any[] = []; // baris dgn id nyata (bukan '0'/kosong)
      const newRows: any[] = [];

      for (const data of details) {
        // Uppercase HANYA kolom teks manusiawi. id (PK), panjar_id (FK), dan
        // orderanmuatan_nobukti adalah kunci bertipe text (case-sensitive);
        // blanket uppercase meng-corrupt id sehingga lookup-by-id gagal.
        if (typeof data.keterangan === 'string') {
          data.keterangan = data.keterangan.toUpperCase();
        }

        data.estimasi = this.toNumeric(data.estimasi);
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
            existingRows.push(data);
          } else {
            // id dikirim tapi barisnya sudah tidak ada (mis. dihapus user lain)
            // -> perlakukan sebagai baris baru daripada menelan datanya diam2.
            data.created_at = time;
            data.updated_at = time;
            data.aksi = 'CREATE';
            newRows.push(data);
          }
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
          .update({
            nobukti: row.nobukti,
            panjar_id: row.panjar_id ?? id,
            orderanmuatan_nobukti: row.orderanmuatan_nobukti,
            estimasi: row.estimasi,
            nominal: row.nominal,
            keterangan: row.keterangan,
            info: row.info ?? null,
            modifiedby: row.modifiedby,
            created_at: row.created_at,
            updated_at: row.updated_at,
          })
          .returning('*');
        if (res && res[0]) updatedData = res[0];
      }

      // Baris di DB (panjar_id = id) yang tak dikirim lagi -> log DELETE, hapus.
      const incomingIds = existingRows.map((r) => r.id);
      const getDeleted = await trx(this.tableName)
        .where('panjar_id', id)
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
        .where('panjar_id', id)
        .modify((qb: any) => {
          if (incomingIds.length) qb.whereNotIn('id', incomingIds);
        })
        .del();

      // INSERT baris baru dgn uuid v7.
      let insertedData: any = null;
      if (newRows.length > 0) {
        const toInsert = newRows.map((r: any) => ({
          nobukti: r.nobukti,
          panjar_id: id,
          orderanmuatan_nobukti: r.orderanmuatan_nobukti,
          estimasi: r.estimasi,
          nominal: r.nominal,
          keterangan: r.keterangan,
          info: r.info ?? null,
          modifiedby: r.modifiedby,
          created_at: r.created_at,
          updated_at: r.updated_at,
        }));

        insertedData = await trx(this.tableName)
          .insert(await withUuidV7(trx, toInsert))
          .returning('*')
          .then((result: any) => result[0])
          .catch((error: any) => {
            console.error('Error inserting data panjar muatan detail:', error);
            throw error;
          });
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'PANJAR HEADER',
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
        'Error process creating panjar muatan detail in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process creating panjar muatan detail in service',
      );
    }
  }

  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    // panjar_id diurus terpisah (exact match) oleh pemanggil.
    const excludeSearchKeys = ['panjar_id'];

    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );

    if (search && searchFields.length > 0) {
      const sanitizedValue = String(search).trim();

      qb.where((query: any) => {
        searchFields.forEach((field) => {
          if (['created_at', 'updated_at'].includes(field)) {
            query.orWhereRaw("TO_CHAR(p.??, 'DD-MM-YYYY HH24:MI:SS') ilike ?", [
              field,
              `%${sanitizedValue}%`,
            ]);
          } else if (field === 'estimasi' || field === 'nominal') {
            // Bertipe numeric: wajib cast ke text dulu. `ilike` langsung ke
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

      const sanitizedValue = String(value);
      switch (key) {
        case 'created_at':
        case 'updated_at':
          qb.andWhereRaw("TO_CHAR(p.??, 'DD-MM-YYYY HH24:MI:SS') ilike ?", [
            key,
            `%${sanitizedValue}%`,
          ]);
          break;
        case 'estimasi':
        case 'nominal':
          qb.andWhereRaw('p.??::text like ?', [key, `%${sanitizedValue}%`]);
          break;
        default:
          qb.andWhere(`p.${key}`, 'ilike', `%${sanitizedValue}%`);
      }
    }
  }

  async findAll(
    id: string,
    trx: any,
    { search, filters, pagination, sort, useCustomOffset }: FindAllParams,
  ) {
    const { page = 1, limit = 0, customOffset } = pagination ?? {};

    if (!id || String(id) === '0') {
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

      // COUNT dari view dengan filter yang SAMA persis dengan query data —
      // memakai COUNT tanpa filter membuat totalPages dan windowed pagination
      // ikut salah begitu ada filter kolom / search aktif.
      const countResult = await trx(`${this.viewName} as p`)
        .count('p.id as total')
        .where('p.panjar_id', id)
        .modify((qb: any) => this.applyFilters(qb, safeFilters, search))
        .first();
      const total = Number(countResult?.total ?? 0);

      const query = trx(`${this.viewName} as p`)
        .select(
          'p.id',
          'p.panjar_id',
          'p.nobukti',
          'p.orderanmuatan_nobukti',
          'p.estimasi',
          'p.nominal',
          'p.keterangan',
          'p.info',
          'p.modifiedby',
          trx.raw(
            "TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
        )
        .where('p.panjar_id', id);

      query.modify((qb: any) => this.applyFilters(qb, safeFilters, search));

      // Urutan HARUS deterministik: tanpa itu offset/limit bisa memulangkan
      // baris yang sama di dua halaman berbeda (atau melewatkan baris) saat
      // grid menggeser window. Seluruh detail satu bukti di-insert dalam satu
      // batch sehingga created_at-nya identik — id (PK, unik) jadi tiebreaker
      // terakhir supaya urutan dijamin total dan stabil antar request.
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
      // seluruh detail satu panjar sekaligus (FormPanjarHeader, exportToExcel).
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
            ? 'Panjar Muatan Detail data fetched successfully'
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
      console.error('Error to findAll panjar muatan detail in service', error);
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
          postingdari: 'DELETE PANJAR MUATAN DETAIL',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: String(modifiedby ?? '').toUpperCase(),
        },
        trx,
      );

      return { status: 200, message: 'Data deleted successfully', deletedData };
    } catch (error) {
      console.log('Error deleting panjar muatan detail in service:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete panjar muatan detail in service',
      );
    }
  }

  async findOne(id: string, trx: any) {
    try {
      const result = await trx(`${this.viewName} as p`)
        .select('p.*')
        .where('p.id', id)
        .first();

      if (!result) {
        throw new NotFoundException('Data not found');
      }

      return result;
    } catch (error) {
      console.error('Error fetching panjar muatan detail by id:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to fetch data by id');
    }
  }
}
