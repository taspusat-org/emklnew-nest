import { Inject, Injectable, Logger } from '@nestjs/common';
import { CreateMarketingorderanDto } from './dto/create-marketingorderan.dto';
import { UpdateMarketingorderanDto } from './dto/update-marketingorderan.dto';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class MarketingorderanService {
  private readonly tableName = 'marketingorderan';
  private readonly logger = new Logger(MarketingorderanService.name);

  constructor(
    // @Inject('REDIS_CLIENT')
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}

  async create(
    marketingOrderanData: any,
    marketing_id: any = 0,
    trx: any = null,
  ) {
    try {
      // Rewrite Postgres: tanpa temp table + OPENJSON (knex-pg tak dukung
      // UPDATE/DELETE dengan JOIN). Upsert: update per-baris, hapus via
      // whereNotIn, insert baru dengan withUuidV7.
      const time = this.utilsService.getTime();
      const logData: any[] = [];

      if (marketingOrderanData.length === 0) {
        await trx(this.tableName).delete().where('marketing_id', marketing_id);
        return;
      }

      const fixData = marketingOrderanData.map(
        ({ statusaktifOrderan_nama, ...rest }) => ({ ...rest }),
      );

      const existingRows: any[] = [];
      const newRows: any[] = [];

      for (const data of fixData) {
        // Uppercase hanya kolom teks manusiawi. id (PK), marketing_id (FK), dan
        // statusaktif (status) adalah UUID/kunci bertipe text (case-sensitive);
        // blanket uppercase meng-corrupt id sehingga lookup-by-id gagal.
        ['nama', 'keterangan', 'singkatan'].forEach((field) => {
          if (typeof data[field] === 'string') {
            data[field] = data[field].toUpperCase();
          }
        });

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

      let updatedData: any = null;
      for (const row of existingRows) {
        const res = await trx(this.tableName)
          .where('id', row.id)
          .update({
            marketing_id: row.marketing_id ?? marketing_id,
            nama: row.nama,
            keterangan: row.keterangan,
            singkatan: row.singkatan,
            statusaktif: row.statusaktif,
            info: row.info,
            modifiedby: row.modifiedby,
            created_at: row.created_at,
            updated_at: row.updated_at,
          })
          .returning('*');
        if (res && res[0]) updatedData = res[0];
      }

      const incomingIds = existingRows.map((r) => r.id);
      const getDeleted = await trx(this.tableName)
        .where('marketing_id', marketing_id)
        .modify((qb: any) => {
          if (incomingIds.length) qb.whereNotIn('id', incomingIds);
        })
        .select(
          'id',
          'marketing_id',
          'nama',
          'keterangan',
          'singkatan',
          'statusaktif',
          'info',
          'modifiedby',
          'created_at',
          'updated_at',
        );
      const pushToLogWithAction = getDeleted.map((entry: any) => ({
        ...entry,
        aksi: 'DELETE',
      }));
      const finalData = logData.concat(pushToLogWithAction);

      await trx(this.tableName)
        .where('marketing_id', marketing_id)
        .modify((qb: any) => {
          if (incomingIds.length) qb.whereNotIn('id', incomingIds);
        })
        .del();

      let insertedData: any = null;
      if (newRows.length > 0) {
        const toInsert = newRows.map((r: any) => ({
          marketing_id,
          nama: r.nama,
          keterangan: r.keterangan,
          singkatan: r.singkatan,
          statusaktif: r.statusaktif,
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
          postingdari: 'ADD MARKETING ORDERAN FROM MARKETING',
          idtrans: marketing_id,
          nobuktitrans: marketing_id,
          aksi: 'EDIT',
          datajson: JSON.stringify(finalData),
          modifiedby: marketingOrderanData[0].modifiedby || 'UNKNOWN',
        },
        trx,
      );

      return updatedData || insertedData;
    } catch (error) {
      throw new Error(
        `Error inserted marketing orderan in service: ${error.message}`,
      );
    }
  }

  async findAll(
    id: string,
    trx: any,
    { search, filters, pagination, sort, isLookUp }: FindAllParams,
  ) {
    try {
      let { page, limit } = pagination ?? {};
      page = page ?? 1;
      limit = limit ?? 0;

      const query = trx(`${this.tableName} as p`)
        .select(
          'p.id',
          'p.marketing_id',
          'p.nama',
          'p.keterangan',
          'p.singkatan',
          'p.statusaktif',
          'q.memo',
          'q.text as statusaktif_nama',
          'r.nama as marketing_nama',
        )
        .leftJoin('parameter as q', 'p.statusaktif', 'q.id')
        .leftJoin('marketing as r', 'p.marketing_id', 'r.id')
        .where('p.marketing_id', id)
        .orderBy('p.created_at', 'desc'); // Optional: Order by creation date

      if (search) {
        const sanitizedValue = String(search);
        query.where((builder) => {
          builder
            .orWhere('p.nama', 'ilike', `%${sanitizedValue}%`)
            .orWhere('p.keterangan', 'ilike', `%${sanitizedValue}%`)
            .orWhere('p.singkatan', 'ilike', `%${sanitizedValue}%`)
            // .orWhere('q.text', 'ilike', `%${sanitizedValue}%`)
            .orWhere('r.nama', 'ilike', `%${sanitizedValue}%`);
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value);
          if (value) {
            if (key === 'statusaktif_nama') {
              query.andWhere(`q.id`, '=', sanitizedValue);
            } else if (key === 'marketing_nama') {
              query.andWhere('r.nama', 'ilike', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`u.${key}`, 'ilike', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'marketing_nama') {
          query.orderBy('r.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'statusaktif') {
          const memoExpr = '(CASE WHEN q.memo IS JSON THEN q.memo::jsonb END)';
          query.orderByRaw(
            `JSON_VALUE(${memoExpr}, '$.MEMO') ${sort.sortDirection}`,
          );
        } else {
          query.orderBy(sort.sortBy, sort.sortDirection);
        }
      }

      const result = await query;

      if (!result.length) {
        this.logger.warn(
          `No data marketing orderan found for id marketing_id: ${id}`,
        );

        return {
          status: false,
          message: 'No Data marketing orderan Found',
          data: [],
        };
      }

      return {
        status: true,
        message: 'marketing orderan data fetched successfully',
        data: result,
      };
    } catch (error) {
      console.error('Error to findAll Marketing Orderan', error);
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} marketingorderan`;
  }

  update(id: string, updateMarketingorderanDto: UpdateMarketingorderanDto) {
    return `This action updates a #${id} marketingorderan`;
  }

  remove(id: string) {
    return `This action removes a #${id} marketingorderan`;
  }
}
