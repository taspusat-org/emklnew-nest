import { Injectable, Logger } from '@nestjs/common';
import { CreateMarketingbiayaDto } from './dto/create-marketingbiaya.dto';
import { UpdateMarketingbiayaDto } from './dto/update-marketingbiaya.dto';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class MarketingbiayaService {
  private readonly tableName = 'marketingbiaya';
  private readonly logger = new Logger(MarketingbiayaService.name);

  constructor(
    // @Inject('REDIS_CLIENT')
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}

  async create(
    marketingBiayaData: any,
    marketing_id: any = 0,
    trx: any = null,
  ) {
    try {
      // Rewrite Postgres: tanpa temp table + OPENJSON (knex-pg tak dukung
      // UPDATE/DELETE dengan JOIN). Upsert langsung: update per-baris, hapus
      // baris tak-dikirim via whereNotIn, insert baru dengan withUuidV7.
      const time = this.utilsService.getTime();
      const logData: any[] = [];

      if (marketingBiayaData.length === 0) {
        await trx(this.tableName).delete().where('marketing_id', marketing_id);
        return;
      }

      const fixData = marketingBiayaData.map(
        ({ statusaktifBiaya_nama, jenisbiayamarketing_nama, ...rest }) => ({
          ...rest,
        }),
      );

      const existingRows: any[] = [];
      const newRows: any[] = [];

      for (const data of fixData) {
        // Blanket-uppercase dihapus: tabel ini hanya punya kolom kunci (id,
        // marketing_id/jenisbiayamarketing_id FK, statusaktif) + numerik + info;
        // tak ada kolom teks manusiawi. Blanket uppercase meng-corrupt id/FK
        // UUID (case-sensitive) sehingga lookup-by-id gagal.

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
            jenisbiayamarketing_id: row.jenisbiayamarketing_id,
            nominal: row.nominal,
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
          'jenisbiayamarketing_id',
          'nominal',
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
          jenisbiayamarketing_id: r.jenisbiayamarketing_id,
          nominal: r.nominal,
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
          postingdari: 'ADD MARKETING BIAYA FROM MARKETING',
          idtrans: marketing_id,
          nobuktitrans: marketing_id,
          aksi: 'EDIT',
          datajson: JSON.stringify(finalData),
          modifiedby: marketingBiayaData[0].modifiedby || 'UNKNOWN',
        },
        trx,
      );
      return updatedData || insertedData;
    } catch (error) {
      throw new Error(
        `Error inserted marketing biaya in service: ${error.message}`,
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

      const query = trx(`${this.tableName} as u`)
        .select(
          'u.id',
          'u.marketing_id',
          'u.jenisbiayamarketing_id',
          'u.nominal',
          'u.statusaktif',
          'p.memo',
          'p.text as statusaktif_nama',
          'q.nama as marketing_nama',
          'r.nama as jenisbiayamarketing_nama',
        )
        .leftJoin('parameter as p', 'u.statusaktif', 'p.id')
        .leftJoin('marketing as q', 'u.marketing_id', 'q.id')
        .leftJoin(
          'jenisbiayamarketing as r',
          'u.jenisbiayamarketing_id',
          'r.id',
        )
        .where('u.marketing_id', id)
        .orderBy('u.created_at', 'desc'); // Optional: Order by creation date

      if (search) {
        const sanitizedValue = String(search);
        query.where((builder) => {
          builder
            .orWhere('u.nominal', 'ilike', `%${sanitizedValue}%`)
            // .orWhere('p.text', 'ilike', `%${sanitizedValue}%`)
            .orWhere('q.nama', 'ilike', `%${sanitizedValue}%`)
            .orWhere('r.nama', 'ilike', `%${sanitizedValue}%`);
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value);
          if (value) {
            if (key === 'statusaktif_nama') {
              query.andWhere(`p.id`, '=', sanitizedValue);
            } else if (key === 'marketing_nama') {
              query.andWhere('q.nama', 'ilike', `%${sanitizedValue}%`);
            } else if (key === 'jenisbiayamarketing_nama') {
              query.andWhere('r.nama', 'ilike', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`u.${key}`, 'ilike', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'marketing_nama') {
          query.orderBy('q.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'jenisbiayamarketing_nama') {
          query.orderBy('r.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'statusaktif') {
          const memoExpr = '(CASE WHEN p.memo IS JSON THEN p.memo::jsonb END)';
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
          `No data marketing biaya found for id marketing_id: ${id}`,
        );

        return {
          status: false,
          message: 'No Data marketing biaya Found',
          data: [],
        };
      }

      return {
        status: true,
        message: 'marketing biaya data fetched successfully',
        data: result,
      };
    } catch (error) {
      console.error('Error to findAll Marketing Biaya', error, error.message);
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} marketingbiaya`;
  }

  update(id: string, updateMarketingbiayaDto: UpdateMarketingbiayaDto) {
    return `This action updates a #${id} marketingbiaya`;
  }

  remove(id: string) {
    return `This action removes a #${id} marketingbiaya`;
  }
}
