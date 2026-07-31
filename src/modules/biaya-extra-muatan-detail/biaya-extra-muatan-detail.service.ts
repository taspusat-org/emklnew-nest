import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateBiayaExtraMuatanDetailDto } from './dto/create-biaya-extra-muatan-detail.dto';
import { UpdateBiayaExtraMuatanDetailDto } from './dto/update-biaya-extra-muatan-detail.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';

@Injectable()
export class BiayaExtraMuatanDetailService {
  private readonly tableNameBiayaExraHeader: string = 'biayaextraheader';
  private readonly tableName: string = 'biayaextramuatandetail';

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}

  async create(details: any, id: any = 0, trx: any = null) {
    // Rewrite Postgres: TANPA temp table + OPENJSON. OPENJSON adalah fungsi SQL
    // Server (tak ada di PG -> "function openjson(unknown) does not exist"), dan
    // jsonExtract memakai jsonb_path_query yang mengembalikan jsonb ber-quote
    // (korupsi nilai). Upsert langsung dari array JS: update per-baris existing,
    // hapus baris yang tak dikirim (whereNotIn), insert baris baru dgn
    // withUuidV7. Pola ini sama dengan pengeluarandetail.service.ts.
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
          postingdari: 'ADD BIAYA EXTRA MUATAN BIAYA',
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

  async findAll(
    id: string,
    trx: any,
    { search, filters, pagination, sort, isLookUp }: FindAllParams,
  ) {
    try {
      const { page = 1, limit = 0 } = pagination ?? {};
      const sortBy = sort?.sortBy || 'id';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';

      const buildBaseQuery = () =>
        trx(`${this.tableName} as u`)
          .leftJoin('parameter as p', 'u.statustagih', 'p.id')
          .leftJoin('groupbiayaextra as q', 'u.groupbiayaextra_id', 'q.id')
          .where('biayaextra_id', id);

      const excludeSearchKeys = ['statustagih_text'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      const applyFilters = (qb: any) => {
        if (search) {
          const sanitized = String(search).replace(/\[/g, '[[]').trim();

          qb.where((qb2: any) => {
            searchFields.forEach((field) => {
              if (field === 'groupbiayaextra_text') {
                qb2.orWhere(`q.keterangan`, 'like', `%${sanitized}%`);
              } else {
                qb2.orWhere(`u.${field}`, 'like', `%${sanitized}%`);
              }
            });
          });
        }

        if (filters) {
          for (const [key, value] of Object.entries(filters)) {
            const sanitizedValue = String(value).replace(/\[/g, '[[]');
            if (value) {
              if (key === 'statustagih_text') {
                qb.andWhere(`p.id`, '=', sanitizedValue);
              } else if (key === 'groupbiayaextra_text') {
                qb.andWhere(`q.keterangan`, 'like', `%${sanitizedValue}%`);
              } else {
                qb.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
              }
            }
          }
        }
      };

      const countResult = await buildBaseQuery()
        .count('u.id as total')
        .modify(applyFilters)
        .first();
      const total = Number(countResult?.total ?? 0);

      const query = buildBaseQuery()
        .select(
          'u.id',
          'u.nobukti',
          'u.biayaextra_id',
          'u.orderanmuatan_nobukti',
          'u.estimasi',
          'u.nominal',
          'u.statustagih',
          'u.nominaltagih',
          'u.keterangan',
          'u.groupbiayaextra_id',
          'p.text as statustagih_nama',
          'p.memo as statustagih_memo',
          'q.keterangan as groupbiayaextra_nama',
        )
        .modify(applyFilters);

      // Urutan HARUS deterministik: tanpa itu offset/limit bisa memulangkan
      // baris yang sama di dua halaman berbeda saat grid menggeser window.
      if (sortBy === 'statustagih_text') {
        const memoExpr = '(CASE WHEN p.memo IS JSON THEN p.memo::jsonb END)';
        query.orderByRaw(`JSON_VALUE(${memoExpr}, '$.MEMO') ${sortDirection}`);
      } else if (sortBy === 'groupbiayaextra_text') {
        query.orderBy(`q.keterangan`, sortDirection);
      } else {
        query.orderBy(`u.${sortBy}`, sortDirection);
      }
      if (sortBy !== 'id') {
        query.orderBy('u.id', 'asc');
      }

      const offset = (Number(page) - 1) * Number(limit);
      if (Number(limit) > 0) {
        query.offset(offset).limit(Number(limit));
      }

      const data = await query;
      const totalPages = Number(limit) > 0 ? Math.ceil(total / Number(limit)) : 1;

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
      console.error('Error to findAll Schedule detail in service', error);
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
          modifiedby: modifiedby.toUpperCase(),
        },
        trx,
      );

      return { status: 200, message: 'Data deleted successfully', deletedData };
    } catch (error) {
      console.log(
        'Error deleting data bl detail rincian biaya in service:',
        error,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete data bl detail rincian biaya in service',
      );
    }
  }

  async findOne(id: string, trx: any = null) {
    try {
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.nobukti',
          'u.biayaextra_id',
          'u.orderanmuatan_nobukti as orderan_nobukti',
          'u.estimasi',
          trx.raw("TO_CHAR(header.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'detail.id as orderan_id',
          'detail.nocontainer',
          'detail.noseal',
          'hargatrucking.keterangan as lokasistuffing_nama',
          'shipper.nama as shipper_nama',
          'container.nama as container_nama',
        ])
        .leftJoin(
          'orderanheader as header',
          'u.orderanmuatan_nobukti',
          'header.nobukti',
        )
        .leftJoin('orderanmuatan as detail', 'header.id', 'detail.orderan_id')
        .leftJoin('hargatrucking', 'detail.lokasistuffing', 'hargatrucking.id')
        .leftJoin('shipper', 'detail.shipper_id', 'shipper.id')
        .leftJoin('container', 'detail.container_id', 'container.id')
        .where('u.biayaextra_id', id);

      const data = await query;
      return data;
    } catch (error) {
      console.error('Error fetching data bl header by id:', error);
      throw new Error('Failed to fetch data bl header by id');
    }
  }

  async biayaExraByJob(params: any, trx: any = null) {
    try {
      const { page, limit, search, sortyBy, sortDirection, ...filters } =
        params;
      const query = trx(`${this.tableNameBiayaExraHeader} as u`)
        .select([
          'detail.id',
          'detail.nobukti',
          'detail.biayaextra_id',
          'detail.estimasi',
          'detail.nominal',
        ])
        .leftJoin(
          `${this.tableName} as detail`,
          'u.id',
          'detail.biayaextra_id',
        );

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          if (value) {
            if (key === 'jenisOrderan') {
              query.andWhere(`u.jenisorder_id`, '=', sanitizedValue);
            } else if (key === 'biayaemkl_id') {
              query.andWhere(`u.biayaemkl_id`, '=', sanitizedValue);
            } else if (key === 'job') {
              query.andWhere(
                `detail.orderanmuatan_nobukti`,
                'like',
                `%${sanitizedValue}%`,
              );
            } else {
              query.andWhere(`detail.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }
      const data = await query;
      return data;
    } catch (error) {
      console.error('Error fetching data bl header by id:', error);
      throw new Error('Failed to fetch data bl header by id');
    }
  }

  update(
    id: number,
    updateBiayaExtraMuatanDetailDto: UpdateBiayaExtraMuatanDetailDto,
  ) {
    return `This action updates a #${id} biayaExtraMuatanDetail`;
  }
}
