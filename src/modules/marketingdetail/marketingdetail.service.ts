import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { CreateMarketingdetailDto } from './dto/create-marketingdetail.dto';
import { UpdateMarketingdetailDto } from './dto/update-marketingdetail.dto';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LocksService } from '../locks/locks.service';

@Injectable()
export class MarketingdetailService {
  private readonly tableName = 'marketingdetail';
  private readonly logger = new Logger(MarketingdetailService.name);

  constructor(
    // @Inject('REDIS_CLIENT')
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly locksService: LocksService,
  ) {}

  async create(
    marketingDetailData: any,
    marketingprosesfee_id: any = 0,
    trx: any,
  ) {
    try {
      // Rewrite Postgres: tanpa temp table + OPENJSON (knex-pg tak dukung
      // UPDATE/DELETE dengan JOIN). Upsert: update per-baris, hapus via
      // whereNotIn, insert baru dengan withUuidV7.
      const time = this.utilsService.getTime();
      const logData: any[] = [];

      if (marketingDetailData.length === 0) {
        await trx(this.tableName)
          .delete()
          .where('marketingprosesfee_id', marketingprosesfee_id);
        return;
      }

      const fixData = marketingDetailData.map(
        ({ statusaktif_nama, ...rest }) => ({ ...rest }),
      );

      const existingRows: any[] = [];
      const newRows: any[] = [];

      for (const data of fixData) {
        // Blanket-uppercase dihapus: tabel ini hanya punya kolom kunci (id,
        // marketing_id/marketingprosesfee_id FK, statusaktif) + numerik + info;
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
            marketing_id: row.marketing_id,
            marketingprosesfee_id:
              row.marketingprosesfee_id ?? marketingprosesfee_id,
            nominalawal: row.nominalawal,
            nominalakhir: row.nominalakhir,
            persentase: row.persentase,
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
        .where('marketingprosesfee_id', marketingprosesfee_id)
        .modify((qb: any) => {
          if (incomingIds.length) qb.whereNotIn('id', incomingIds);
        })
        .select(
          'id',
          'marketing_id',
          'marketingprosesfee_id',
          'nominalawal',
          'nominalakhir',
          'persentase',
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
        .where('marketingprosesfee_id', marketingprosesfee_id)
        .modify((qb: any) => {
          if (incomingIds.length) qb.whereNotIn('id', incomingIds);
        })
        .del();

      let insertedData: any = null;
      if (newRows.length > 0) {
        const toInsert = newRows.map((r: any) => ({
          marketing_id: r.marketing_id,
          marketingprosesfee_id,
          nominalawal: r.nominalawal,
          nominalakhir: r.nominalakhir,
          persentase: r.persentase,
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
          postingdari: 'ADD MARKETING PROSES FEE FROM MARKETING',
          idtrans: marketingprosesfee_id,
          nobuktitrans: marketingprosesfee_id,
          aksi: 'EDIT',
          datajson: JSON.stringify(finalData),
          modifiedby: fixData[0].modifiedby || 'UNKNOWN',
        },
        trx,
      );

      return updatedData || insertedData;
    } catch (error) {
      throw new Error(
        `Error inserted marketing detail in service: ${error.message}`,
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
          'u.marketingprosesfee_id',
          'u.nominalawal',
          'u.nominalakhir',
          'u.persentase',
          'u.statusaktif',
          'p.nama as marketing_nama',
          'q.memo',
          'q.text as statusaktif_nama',
        )
        .leftJoin('marketing as p', 'u.marketing_id', 'p.id')
        // .leftJoin('marketingprosesfee as r', 'p.marketingprosesfee_id', 'r.id')
        .leftJoin('parameter as q', 'u.statusaktif', 'q.id')
        .where('u.marketingprosesfee_id', id)
        .orderBy('u.created_at', 'desc');

      if (search) {
        const sanitizedValue = String(search);
        query.where((builder) => {
          builder
            .orWhere('p.nama', 'ilike', `%${sanitizedValue}%`)
            .orWhere('u.nominalawal', 'ilike', `%${sanitizedValue}%`)
            .orWhere('u.nominalakhir', 'ilike', `%${sanitizedValue}%`)
            .orWhere('u.persentase', 'ilike', `%${sanitizedValue}%`);
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value);
          if (value) {
            if (key === 'statusaktif_nama') {
              query.andWhere(`q.id`, '=', sanitizedValue);
            } else if (key === 'marketing_nama') {
              query.andWhere('p.nama', 'ilike', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`u.${key}`, 'ilike', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort.sortBy === 'marketing_nama') {
          query.orderBy('p.nama', sort.sortDirection);
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
          `No data marketing detail found for id marketingprosesfee_id: ${id}`,
        );

        return {
          status: false,
          message: 'No Data marketing detail Found',
          data: [],
        };
      }

      return {
        status: true,
        message: 'marketing detail data fetched successfully',
        data: result,
      };
    } catch (error) {
      console.error('Error to findAll Marketing Detail', error);
      throw new Error(error);
    }
  }

  async checkValidasi(aksi: string, value: any, editedby: any, trx: any) {
    try {
      if (aksi === 'EDIT') {
        const forceEdit = await this.locksService.forceEdit(
          this.tableName,
          value,
          editedby,
          trx,
        );

        return forceEdit;
        // } else if (aksi === 'DELETE') {
        //   const validasi = await this.globalService.checkUsed(
        //     'akunpusat',
        //     'type_id',
        //     value,
        //     trx,
        //   );

        //   return validasi;
      }
    } catch (error) {
      console.error(
        'Error check validasi edit marketing detail di function checkValidasi:',
        error,
      );
      throw new InternalServerErrorException(
        'Failed to check validation edit marketing',
      );
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} marketingdetail`;
  }

  update(id: string, updateMarketingdetailDto: UpdateMarketingdetailDto) {
    return `This action updates a #${id} marketingdetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} marketingdetail`;
  }
}
