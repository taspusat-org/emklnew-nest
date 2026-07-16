import { Injectable, Logger } from '@nestjs/common';
import { CreateMarketingmanagerDto } from './dto/create-marketingmanager.dto';
import { UpdateMarketingmanagerDto } from './dto/update-marketingmanager.dto';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class MarketingmanagerService {
  private readonly tableName = 'marketingmanager';
  private readonly logger = new Logger(MarketingmanagerService.name);

  constructor(
    // @Inject('REDIS_CLIENT')
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}

  async create(
    marketingManagerData: any,
    marketing_id: any = 0,
    trx: any = null,
  ) {
    try {
      // Rewrite Postgres: tanpa temp table + OPENJSON (knex-pg tak dukung
      // UPDATE/DELETE dengan JOIN). Upsert: update per-baris, hapus via
      // whereNotIn, insert baru dengan withUuidV7.
      const time = this.utilsService.getTime();
      const logData: any[] = [];

      if (marketingManagerData.length === 0) {
        await trx(this.tableName).delete().where('marketing_id', marketing_id);
        return;
      }

      const fixData = marketingManagerData.map(
        ({ managermarketing_nama, statusaktifManager_nama, ...rest }) => ({
          ...rest,
        }),
      );

      const existingRows: any[] = [];
      const newRows: any[] = [];

      for (const data of fixData) {
        // Blanket-uppercase dihapus: tabel ini hanya punya kolom kunci (id,
        // marketing_id/managermarketing_id FK, status*) + info; tak ada kolom
        // teks manusiawi (userapproval = username, jangan di-uppercase). Blanket
        // uppercase meng-corrupt id/FK UUID (case-sensitive) → lookup-by-id gagal.

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
            managermarketing_id: row.managermarketing_id,
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
          'managermarketing_id',
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
          managermarketing_id: r.managermarketing_id,
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
          postingdari: 'ADD MARKETING MANAGER FROM MARKETING',
          idtrans: marketing_id,
          nobuktitrans: marketing_id,
          aksi: 'EDIT',
          datajson: JSON.stringify(finalData),
          modifiedby: marketingManagerData[0].modifiedby || 'UNKNOWN',
        },
        trx,
      );

      return updatedData || insertedData;
    } catch (error) {
      throw new Error(
        `Error inserted marketing manager in service: ${error.message}`,
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
          'u.managermarketing_id',
          trx.raw("TO_CHAR(u.tglapproval, 'DD-MM-YYYY') as tglapproval"),
          'u.statusapproval',
          'u.userapproval',
          'u.statusaktif',
          'p.nama as marketing_nama',
          'q.nama as managermarketing_nama',
          'statusapproval.text as statusapproval_nama',
          'statusaktif.text as statusaktif_nama',
          'statusaktif.memo',
          'statusapproval.memo as approvalmemo',
        )
        .leftJoin('marketing as p', 'u.marketing_id', 'p.id')
        .leftJoin('managermarketing as q', 'u.managermarketing_id', 'q.id')
        .leftJoin(
          'parameter as statusapproval',
          'u.statusapproval',
          'statusapproval.id',
        )
        .leftJoin('parameter as statusaktif', 'u.statusaktif', 'statusaktif.id')
        .where('u.marketing_id', id)
        .orderBy('u.created_at', 'desc');

      if (search) {
        const sanitizedValue = String(search);
        query.where((builder) => {
          builder
            .orWhere('p.nama', 'ilike', `%${sanitizedValue}%`)
            .orWhere('q.nama', 'ilike', `%${sanitizedValue}%`)
            .orWhereRaw("TO_CHAR(u.tglapproval, 'DD-MM-YYYY') ILIKE ?", [
              `%${sanitizedValue}%`,
            ])
            .orWhere('u.userapproval', 'ilike', `%${sanitizedValue}%`);
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value);
          if (value) {
            if (key === 'statusaktif_nama') {
              query.andWhere(`statusaktif.id`, '=', sanitizedValue);
            } else if (key === 'statusapproval_nama') {
              query.andWhere(`statusapproval.id`, '=', sanitizedValue);
            } else if (key === 'marketing_nama') {
              query.andWhere('p.nama', 'ilike', `%${sanitizedValue}%`);
            } else if (key === 'managermarketing_nama') {
              query.andWhere('q.nama', 'ilike', `%${sanitizedValue}%`);
            } else if (key === 'tglapproval') {
              query.andWhereRaw("TO_CHAR(u.tglapproval, 'DD-MM-YYYY') ILIKE ?", [
                `%${sanitizedValue}%`,
              ]);
            } else {
              query.andWhere(`u.${key}`, 'ilike', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'marketing_nama') {
          query.orderBy('p.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'managermarketing') {
          query.orderBy('q.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'statusapproval') {
          const memoExpr = '(CASE WHEN statusapproval.memo IS JSON THEN statusapproval.memo::jsonb END)';
          query.orderByRaw(
            `JSON_VALUE(${memoExpr}, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statusaktif') {
          const memoExpr = '(CASE WHEN statusaktif.memo IS JSON THEN statusaktif.memo::jsonb END)';
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
          `No data marketing manager found for id marketing_id: ${id}`,
        );

        return {
          status: false,
          message: 'No Data marketing manager Found',
          data: [],
        };
      }

      return {
        status: true,
        message: 'marketing manager data fetched successfully',
        data: result,
      };
    } catch (error) {
      console.error('Error to findAll Marketing Manager', error);
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} marketingmanager`;
  }

  update(id: string, updateMarketingmanagerDto: UpdateMarketingmanagerDto) {
    return `This action updates a #${id} marketingmanager`;
  }

  remove(id: string) {
    return `This action removes a #${id} marketingmanager`;
  }
}
