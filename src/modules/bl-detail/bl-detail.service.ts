import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateBlDetailDto } from './dto/create-bl-detail.dto';
import { UpdateBlDetailDto } from './dto/update-bl-detail.dto';
import { withUuidV7, UtilsService } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { BlDetailRincianService } from '../bl-detail-rincian/bl-detail-rincian.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class BlDetailService {
  private readonly tableName: string = 'bldetail';
  // Tabel base untuk TULIS, view untuk BACA (lihat create-vbl-pg.sql).
  private readonly viewName: string = 'vbldetail';

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly blDetailRincianService: BlDetailRincianService,
  ) { }

  async create(details: any, id: any = 0, trx: any = null) {
    try {
      const allRincian: any[] = []; // Ambil semua data rincian di luar mapping utama
      let insertedData = null;
      const logData: any[] = [];
      const mainDataToInsert: any[] = [];
      const time = this.utilsService.getTime();
      // Tanpa prefiks '##' (global temp ala MSSQL): '#' bukan identifier valid
      // di Postgres saat direferensikan mentah, mis. trx.raw(`${temp}.kolom`).
      // Sama seperti ShippingInstructionDetailService.
      const tempTableName = `temp_${Math.random().toString(36).substring(2, 15)}`;
      const tableTemp = await this.utilsService.createTempTable(
        this.tableName,
        trx,
        tempTableName,
      );

      if (details.length === 0) {
        await trx(this.tableName).delete().where('bl_id', id);
        return;
      }

      for (const data of details) {
        let isDataChanged = false;

        // Uppercase hanya kolom teks manusiawi. id (PK), bl_id (FK), dan
        // *_nobukti/*_uuid adalah UUID/kunci bertipe text (case-sensitive);
        // blanket uppercase meng-corrupt id sehingga lookup-by-id gagal (edit
        // jadi hapus+insert baris baru).
        ['keterangan', 'noblconecting'].forEach((field) => {
          if (typeof data[field] === 'string') {
            data[field] = data[field].toUpperCase();
          }
        });

        const { detailsrincian, ...detailsWithoutRincian } = data;

        // Extract dan simpan data rincian jika ada
        let tempRincian: any = {};
        if (detailsrincian && detailsrincian.length > 0) {
          tempRincian = {
            rincian: [...detailsrincian], // Copy array rincian
          };
        }

        if (tempRincian) {
          allRincian.push(tempRincian);
        }

        // id kosong atau '0' = baris baru; pengirim antar-service memakai '0'.
        if (
          detailsWithoutRincian.id &&
          String(detailsWithoutRincian.id) !== '0'
        ) {
          const existingData = await trx(this.tableName)
            .where('id', detailsWithoutRincian.id)
            .first();

          if (existingData) {
            const createdAt = {
              created_at: existingData.created_at,
              updated_at: existingData.updated_at,
            };
            Object.assign(detailsWithoutRincian, createdAt);

            if (
              this.utilsService.hasChanges(detailsWithoutRincian, existingData)
            ) {
              detailsWithoutRincian.updated_at = time;
              isDataChanged = true;
              detailsWithoutRincian.aksi = 'UPDATE';
            }
          }
        } else {
          const newTimestamps = {
            // New record: Set timestamps
            created_at: time,
            updated_at: time,
          };
          Object.assign(detailsWithoutRincian, newTimestamps);
          isDataChanged = true;
          detailsWithoutRincian.aksi = 'CREATE';
        }

        if (!isDataChanged) {
          detailsWithoutRincian.aksi = 'NO UPDATE';
        }

        const { aksi, ...dataForInsert } = detailsWithoutRincian;
        mainDataToInsert.push(dataForInsert);
        logData.push({
          ...detailsWithoutRincian,
          created_at: time,
        });
      }
      await trx.raw(tableTemp);

      const jsonString = JSON.stringify(mainDataToInsert);

      // OPENJSON + jsonExtract adalah bentuk SQL Server. Padanannya di Postgres
      // jsonb_populate_recordset(null::<tabel>, ...): satu baris per elemen
      // array, kolom & tipenya mengikuti tabel base (temp dibuat dari
      // `SELECT * ... WHERE 1=0` sehingga bentuknya identik). Pola ini sudah
      // dipakai ShippingInstructionDetailService.
      await trx.raw(
        `insert into "${tempTableName}" select * from jsonb_populate_recordset(null::${this.tableName}, ?::jsonb)`,
        [jsonString],
      );

      // UPDATE ... FROM, bukan .join().update(). Bentuk join+update itu warisan
      // SQL Server; di Postgres knex MENGABAIKAN join-nya sehingga SQL yang
      // dihasilkan menyebut kolom temp tanpa klausa FROM dan gagal dengan
      // "missing FROM-clause entry for table temp_xxx" (SQLSTATE 42P01).
      // Bentuk di bawah mengikuti ShippingInstructionDetailService yang sudah
      // dipakai di Postgres.
      const updatedResult = await trx.raw(
        `update ${this.tableName} as t set
           nobukti = tmp.nobukti,
           bl_nobukti = tmp.bl_nobukti,
           bl_id = tmp.bl_id,
           keterangan = tmp.keterangan,
           noblconecting = tmp.noblconecting,
           shippinginstructiondetail_nobukti = tmp.shippinginstructiondetail_nobukti,
           info = tmp.info,
           modifiedby = tmp.modifiedby,
           created_at = tmp.created_at,
           updated_at = tmp.updated_at
         from "${tempTableName}" as tmp
         where t.id = tmp.id
         returning t.*`,
      );
      const updatedData = updatedResult?.rows ?? [];

      const insertedDataQuery = await trx(tempTableName)
        .select([
          'nobukti',
          'bl_nobukti',
          'bl_id',
          'keterangan',
          'noblconecting',
          'shippinginstructiondetail_nobukti',
          'info',
          'modifiedby',
          'created_at',
          'updated_at',
        ])
        .where(`${tempTableName}.id`, '0');

      const getDeleted = await trx(`${this.tableName} as u`)
        .leftJoin(`${tempTableName}`, 'u.id', `${tempTableName}.id`)
        .select(
          'u.nobukti',
          'u.bl_nobukti',
          'u.bl_id',
          'u.keterangan',
          'u.noblconecting',
          'u.shippinginstructiondetail_nobukti',
          'u.info',
          'u.modifiedby',
          'u.created_at',
          'u.updated_at',
        )
        .whereNull(`${tempTableName}.id`)
        .where('u.bl_id', id);

      let pushToLog: any[] = [];
      if (getDeleted.length > 0) {
        pushToLog = Object.assign(getDeleted, { aksi: 'DELETE' });
      }

      const pushToLogWithAction = pushToLog.map((entry) => ({
        ...entry,
        aksi: 'DELETE',
      }));

      const finalData = logData.concat(pushToLogWithAction);

      const deletedData = await trx(this.tableName)
        .leftJoin(
          `${tempTableName}`,
          `${this.tableName}.id`,
          `${tempTableName}.id`,
        )
        .whereNull(`${tempTableName}.id`)
        .where(`${this.tableName}.bl_id`, id)
        .del();

      // Insert new records
      if (insertedDataQuery.length > 0) {
        insertedData = await trx(this.tableName)
          .insert(await withUuidV7(trx, insertedDataQuery))
          .returning('*');
      }

      // PROSES DETAIL RINCIAN, Gabungkan detail yang sudah ada dengan yang baru diinsert
      const allDetails = [...(updatedData || []), ...(insertedData || [])];

      for (let i = 0; i < allRincian.length; i++) {
        // Map rincian dengan ID detail yang benar
        const rincianItem = allRincian[i];

        // Panggil service rincian jika ada data rincian
        if (rincianItem.rincian && rincianItem.rincian.length > 0) {
          // Tambahkan keperluan data lainnya ke setiap rincian
          const fixDataRincian = rincianItem.rincian.map((r: any) => ({
            ...r,
            bldetail_id: allDetails[i].id,
            bldetail_nobukti: allDetails[i].bl_nobukti,
          }));

          const test = await this.blDetailRincianService.create(
            fixDataRincian,
            allDetails[i].id,
            trx,
          );
        }
      }
      console.log('insertedData', insertedData, 'updatedData', updatedData);

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD BL DETAIL',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(finalData),
          modifiedby: details[0].modifiedby,
        },
        trx,
      );

      return updatedData || insertedData;
    } catch (error) {
      console.error(
        'Error process creating bl detail in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process creating bl detail in service',
      );
    }
  }

  /**
   * bl_id diturunkan ke vbldetail lewat GUC supaya keempat LEFT JOIN referensi
   * di view (shippinginstructiondetail, parameter, emkl, pelayaran) hanya kena
   * baris satu BL — bukan seluruh isi tabel bldetail lalu disaring belakangan.
   *
   * `set_config(..., true)` transaksi-lokal, jadi tidak bocor lewat pool.
   */
  private async setSessionContext(trx: any, id: string): Promise<void> {
    await trx.raw(`SELECT set_config('tas.bl_bl_id', ?, true)`, [
      id ? String(id) : '',
    ]);
  }

  // Kolom yang namanya di grid berbeda dengan namanya di view.
  private static readonly ALIASED_COLUMNS: Record<string, string> = {
    emkllain_text: 'p.emkllain_nama',
    pelayaran_text: 'p.pelayaran_nama',
    statuspisahbl_text: 'p.statuspisahbl_nama',
  };

  private columnFor(key: string): string {
    return BlDetailService.ALIASED_COLUMNS[key] ?? `p.${key}`;
  }

  /**
   * Search global + filter per kolom.
   *
   * Dua hal yang diperbaiki dari versi sebelumnya, keduanya sisa MSSQL:
   *  - `like` -> `ilike`. Di SQL Server LIKE tidak peka huruf besar-kecil, di
   *    Postgres peka. Filter kolom yang diketik huruf kecil karena itu tidak
   *    pernah menemukan apa pun.
   *  - Escaping `[` -> `[[]` dibuang. Bracket adalah wildcard di SQL Server,
   *    bukan di Postgres — di sini justru membuat pencarian '[' gagal.
   */
  private applyFilters(
    qb: any,
    filters: Record<string, any> | undefined,
    search?: string,
  ): void {
    // statuspisahbl_text disaring sebagai kecocokan id persis, bukan ilike,
    // jadi tidak ikut dalam pencarian global.
    const excludeSearchKeys = ['statuspisahbl_text'];
    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );

    if (search && searchFields.length > 0) {
      const sanitized = String(search).trim();
      qb.where((inner: any) => {
        searchFields.forEach((field) => {
          inner.orWhere(this.columnFor(field), 'ilike', `%${sanitized}%`);
        });
      });
    }

    Object.entries(filters || {}).forEach(([key, rawValue]) => {
      // Cek eksplisit, bukan `if (value)`: versi lama membuang nilai '0' dan 0
      // yang sebenarnya filter sah.
      if (rawValue === null || rawValue === undefined || rawValue === '')
        return;

      const sanitizedValue = String(rawValue);
      if (key === 'statuspisahbl_text') {
        qb.andWhere('p.statuspisahbl', '=', sanitizedValue);
      } else {
        qb.andWhere(this.columnFor(key), 'ilike', `%${sanitizedValue}%`);
      }
    });
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
      await this.setSessionContext(trx, id);

      // set_config di atas sudah memangkas view, tapi WHERE eksplisit TETAP
      // dipasang. Hasil endpoint ini ikut jadi payload simpan FormBlHeader dan
      // create() menghapus baris yang tidak ada di payload — kalau session
      // context gagal ter-set, tanpa WHERE ini detail milik BL lain ikut
      // terbawa. JANGAN dihapus dengan alasan "sudah ada di view".
      const scoped = (qb: any) => {
        qb.where('p.bl_id', id);
        this.applyFilters(qb, filters, search);
      };

      // Dulu query ini menembak tabel base lalu LEFT JOIN 4 tabel referensi DI
      // SETIAP REQUEST, dan grid detail di-refetch tiap kali baris master
      // berganti. Sekarang baca lewat view (lihat create-vbl-pg.sql).
      const countResult = await trx(`${this.viewName} as p`)
        .modify(scoped)
        .count('* as total')
        .first();
      const total = Number(countResult?.total ?? 0);

      const query = trx(`${this.viewName} as p`)
        .select(
          'p.id',
          'p.nobukti',
          'p.bl_id',
          'p.bl_nobukti',
          'p.keterangan',
          'p.noblconecting',
          'p.shippinginstructiondetail_nobukti',
          'p.asalpelabuhan',
          'p.consignee',
          'p.shipper',
          'p.comodity',
          'p.notifyparty',
          // emkl_id dipetakan GridBlDetail (mapDetailRows) tapi tidak pernah
          // ikut di select versi lama, jadi nilainya selalu undefined di grid.
          'p.emkl_id',
          'p.statuspisahbl',
          'p.statuspisahbl_nama',
          'p.statuspisahbl_memo',
          'p.emkllain_nama',
          'p.pelayaran_nama',
        )
        .modify(scoped);

      // Urutan HARUS deterministik: tanpa itu offset/limit bisa memulangkan
      // baris yang sama di dua halaman berbeda (atau melewatkan baris) saat
      // grid menggeser window. Sort dari grid jadi primary, id (PK, unik)
      // sebagai tiebreaker supaya urutan total dan stabil.
      const sortBy = sort?.sortBy || 'nobukti';
      const sortDirection =
        String(sort?.sortDirection).toLowerCase() === 'desc' ? 'desc' : 'asc';
      const orderCol = this.columnFor(sortBy);

      query.orderBy(orderCol, sortDirection);
      if (orderCol !== 'p.id') {
        query.orderBy('p.id', 'asc');
      }

      // limit 0/undefined = ambil semua. Dipakai pemanggil non-grid yang butuh
      // seluruh detail satu BL sekaligus (form edit, export/cetak).
      if (Number(limit) > 0) {
        query.offset((Number(page) - 1) * Number(limit)).limit(Number(limit));
      }

      const data = await query;
      const totalPages =
        Number(limit) > 0 ? Math.ceil(total / Number(limit)) : 1;

      return {
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
      console.error('Error to findAll bl detail in service', error);
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} blDetail`;
  }

  update(id: string, updateBlDetailDto: UpdateBlDetailDto) {
    return `This action updates a #${id} blDetail`;
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
          postingdari: 'DELETE BL DETAIL',
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
      console.log('Error deleting data bl detail in service:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete data bl detail in service',
      );
    }
  }
}
