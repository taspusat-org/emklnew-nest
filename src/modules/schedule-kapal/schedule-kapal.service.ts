import {
  Inject,
  Injectable,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { CreateScheduleKapalDto } from './dto/create-schedule-kapal.dto';
// import { UpdateScheduleKapalDto } from './dto/update-schedule-kapal.dto';
import { withUuidV7, formatDateToSQL, UtilsService  } from 'src/utils/utils.service';
import { RedisService } from 'src/common/redis/redis.service';
import { GlobalService } from '../global/global.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class ScheduleKapalService {
  private readonly tableName: string = 'schedulekapal';

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly utilService: UtilsService,
    // private readonly locksService:
    private readonly redisService: RedisService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
  ) {}

  async create(createData: any, trx: any) {
    try {
      Object.keys(createData).forEach((key) => {
        if (typeof createData[key] === 'string') {
          // createData[key] = createData[key].toUpperCase();

          const value = createData[key];
          const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

          if (dateRegex.test(value)) {
            createData[key] = formatDateToSQL(value);
          } else {
            createData[key] = createData[key].toUpperCase();
          }
        }
      });

      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, createData))
        .returning('*');

      const newData = insertedItems[0];

      await this.logTrailService.create(
        {
          namatable: this.tableName,
          postingdari: 'ADD SCHEDULE KAPAL',
          idtrans: newData.id,
          nobuktitrans: newData.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newData),
          modifiedby: newData.modifiedby,
        },
        trx,
      );

      return {
        newData: newData,
      };
    } catch (error) {
      console.error(
        'Error process approval creating schedule kapal in service:',
        error.message,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process approval creating schedule kapal in service',
      );
    }
  }

  async findAll(
    { search, filters, pagination, sort, isLookUp }: FindAllParams,
    trx: any,
  ) {
    try {
      let { page, limit } = pagination ?? {};
      page = page ?? 1;
      limit = limit ?? 0;

      if (isLookUp) {
        const totalData = await trx(this.tableName)
          .count('id as total')
          .first();

        const resultTotalData = totalData?.total || 0;

        if (Number(resultTotalData) > 500) {
          return { data: { type: 'json' } };
        } else {
          limit = 0;
        }
      }

      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id',
          'u.jenisorder_id',
          'u.voyberangkat',
          'u.keterangan',
          'u.kapal_id',
          'u.pelayaran_id',
          'u.tujuankapal_id',
          'u.asalkapal_id',
          trx.raw("TO_CHAR(u.tglberangkat, 'DD-MM-YYYY') as tglberangkat"),
          trx.raw("TO_CHAR(u.tgltiba, 'DD-MM-YYYY') as tgltiba"),
          // 'u.tglclosing',
          trx.raw("TO_CHAR(u.tglclosing, 'DD-MM-YYYY HH24:MI:SS') as tglclosing"),
          'u.statusberangkatkapal',
          'u.statustibakapal',
          'u.batasmuatankapal',
          'u.statusaktif',
          'u.modifiedby',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'a.nama as jenisorderan_nama',
          'b.nama as kapal_nama',
          'c.nama as pelayaran_nama',
          'd.nama as tujuankapal_nama',
          'e.keterangan as asalkapal_nama',
          'p.memo',
          'p.text as statusaktif_nama',
        ])
        .leftJoin('jenisorder as a', 'u.jenisorder_id', 'a.id')
        .leftJoin('kapal as b', 'u.kapal_id', 'b.id')
        .leftJoin('pelayaran as c', 'u.pelayaran_id', 'c.id')
        .leftJoin('tujuankapal as d', 'u.tujuankapal_id', 'd.id')
        .leftJoin('asalkapal as e', 'u.asalkapal_id', 'e.id')
        .leftJoin('parameter as p', 'u.statusaktif', 'p.id');

      if (filters?.join) {
        // Postgres: subquery whereIn, tanpa temp table. Ambil schedule_id yang
        // muncul di tabel join, lalu batasi u.id ke himpunan itu.
        query.whereIn(
          'u.id',
          trx
            .select('a.schedule_id')
            .from(`${filters.join} as a`)
            .whereNotNull('a.schedule_id'),
        );
      }

      if (filters?.notIn) {
        const notInObj =
          typeof filters?.notIn === 'string'
            ? JSON.parse(filters?.notIn)
            : filters?.notIn;

        if (notInObj && typeof notInObj === 'object') {
          // Loop semua key di notIn object
          for (const [key, values] of Object.entries(notInObj)) {
            if (Array.isArray(values) && values.length > 0) {
              query.whereNotIn(`u.${key}`, values);
            }
          }
        }
      }

      const excludeSearchKeys = [
        'tglDari',
        'tglSampai',
        'statusaktif_nama',
        'statusaktif',
      ];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );
      if (search) {
        const sanitized = String(search).trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (field === 'jenisorderan_nama') {
              qb.orWhere(`a.nama`, 'ilike', `%${sanitized}%`);
            } else if (field === 'kapal_nama') {
              qb.orWhere(`b.nama`, 'ilike', `%${sanitized}%`);
            } else if (field === 'pelayaran_nama') {
              qb.orWhere(`c.nama`, 'ilike', `%${sanitized}%`);
            } else if (field === 'tujuankapal_nama') {
              qb.orWhere(`d.nama`, 'ilike', `%${sanitized}%`);
            } else if (field === 'asalkapal_nama') {
              qb.orWhere(`e.keterangan`, 'ilike', `%${sanitized}%`);
            } else if (field === 'created_at' || field === 'updated_at') {
              qb.orWhereRaw(
                `TO_CHAR(u.${field}, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?`,
                [`%${sanitized}%`],
              );
            } else {
              qb.orWhere(`u.${field}`, 'ilike', `%${sanitized}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value);

          if (key === 'join' || key === 'notIn') {
            continue;
          }

          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'statusaktif_nama' || key === 'memo') {
              query.andWhere(`p.text`, '=', sanitizedValue);
            } else if (key === 'jenisorderan_nama') {
              query.andWhere(`a.nama`, 'ilike', `%${sanitizedValue}%`);
            } else if (key === 'kapal_nama') {
              query.andWhere(`b.nama`, 'ilike', `%${sanitizedValue}%`);
            } else if (key === 'pelayaran_nama') {
              query.andWhere(`c.nama`, 'ilike', `%${sanitizedValue}%`);
            } else if (key === 'tujuankapal_nama') {
              query.andWhere(`d.nama`, 'ilike', `%${sanitizedValue}%`);
            } else if (key === 'asalkapal_nama') {
              query.andWhere(`e.keterangan`, 'ilike', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`u.${key}`, 'ilike', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'jenisorderan') {
          query.orderBy('a.nama', sort?.sortDirection);
        } else if (sort?.sortBy === 'kapal') {
          query.orderBy('b.nama', sort?.sortDirection);
        } else if (sort?.sortBy === 'pelayaran') {
          query.orderBy('c.nama', sort?.sortDirection);
        } else if (sort?.sortBy === 'tujuankapal') {
          query.orderBy('d.nama', sort?.sortDirection);
        } else if (sort?.sortBy === 'asalkapal') {
          query.orderBy('e.keterangan', sort?.sortDirection);
        } else {
          query.orderBy(sort.sortBy, sort.sortDirection);
        }
      }

      const result = await trx(this.tableName).count('id as total').first();
      const total = result?.total as number;
      // const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
      const totalPages = Math.ceil(total / limit);
      const data = await query;
      const responseType = Number(total) > 500 ? 'json' : 'local';

      return {
        data: data,
        type: responseType,
        total,
        pagination: {
          currentPage: Number(page),
          totalPages: totalPages,
          totalItems: total,
          itemsPerPage: limit > 0 ? limit : total,
        },
      };
    } catch (error) {
      console.error('Error to findAll Schedule Kapal in Service', error);
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} scheduleKapal`;
  }

  update(id: string, updateScheduleKapalDto: any) {
    return `This action updates a #${id} scheduleKapal`;
  }

  remove(id: string) {
    return `This action removes a #${id} scheduleKapal`;
  }
}
