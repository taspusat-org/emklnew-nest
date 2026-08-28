import {
  Injectable,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { CreateConsigneedetailDto } from './dto/create-consigneedetail.dto';
import { UpdateConsigneedetailDto } from './dto/update-consigneedetail.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';

@Injectable()
export class ConsigneedetailService {
  private readonly tableName = 'consigneedetail';
  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  async create(details: any, id: any = 0, trx: any = null) {
    // Rewrite Postgres: TANPA temp table + OPENJSON. knex-pg tidak mendukung
    // UPDATE/DELETE dengan JOIN (JOIN-nya dibuang → SQL error), jadi upsert
    // dilakukan langsung: update per-baris, hapus baris yang tak dikirim via
    // whereNotIn, dan insert baris baru dengan withUuidV7.
    const time = this.utilsService.getTime();
    const logData: any[] = [];

    if (details.length === 0) {
      await trx(this.tableName).delete().where('consignee_id', id);
      return;
    }

    const existingRows: any[] = []; // baris dengan id nyata (bukan '0')
    const newRows: any[] = [];

    for (const data of details) {
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
    let updatedData: any = null;
    for (const row of existingRows) {
      const res = await trx(this.tableName)
        .where('id', row.id)
        .update({
          keterangan: row.keterangan,
          info: row.info,
          modifiedby: row.modifiedby,
          consignee_id: row.consignee_id ?? id,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })
        .returning('*');
      if (res && res[0]) updatedData = res[0];
    }

    // Baris yang ada di DB tapi tak dikirim lagi → log + hapus.
    const incomingIds = existingRows.map((r) => r.id);
    const getDeleted = await trx(this.tableName)
      .where('consignee_id', id)
      .modify((qb: any) => {
        if (incomingIds.length) qb.whereNotIn('id', incomingIds);
      })
      .select(
        'id',
        'keterangan',
        'info',
        'modifiedby',
        'created_at',
        'updated_at',
        'consignee_id',
      );
    const pushToLogWithAction = getDeleted.map((entry: any) => ({
      ...entry,
      aksi: 'DELETE',
    }));
    const finalData = logData.concat(pushToLogWithAction);

    await trx(this.tableName)
      .where('consignee_id', id)
      .modify((qb: any) => {
        if (incomingIds.length) qb.whereNotIn('id', incomingIds);
      })
      .del();

    // INSERT baris baru.
    let insertedData: any = null;
    if (newRows.length > 0) {
      const toInsert = newRows.map((r: any) => ({
        keterangan: r.keterangan,
        info: r.info,
        modifiedby: r.modifiedby,
        consignee_id: id,
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
        postingdari: 'CONSIGNEE DETAIL',
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

  async findAll({ search, filters, sort }: FindAllParams, trx: any) {
    if (!filters?.consignee_id) {
      return {
        data: [],
      };
    }
    try {
      if (!filters?.consignee_id) {
        return {
          status: true,
          message: 'Jurnal umum Detail failed to fetch',
          data: [],
        };
      }
      const query = trx
        .from(
          trx.raw(
            `${this.tableName} as consigneedetail`,
          ),
        )
        .select(
          'consigneedetail.id',
          'consigneedetail.consignee_id',
          'consigneedetail.keterangan',
          'consigneedetail.info',
          'consigneedetail.modifiedby',
          trx.raw(
            "TO_CHAR(consigneedetail.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(consigneedetail.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
        )
        .orderBy('consigneedetail.created_at', 'desc');

      if (filters?.consignee_id) {
        query.where('consigneedetail.consignee_id', filters?.consignee_id);
      }
      const excludeSearchKeys = ['consignee_id'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k) && filters![k],
      );
      if (search) {
        const sanitized = String(search).trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            qb.orWhere(`consigneedetail.${field}`, 'ilike', `%${sanitized}%`);
          });
        });
      }
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (key === 'consignee_id') {
            continue;
          }
          if (!value) continue;
          const sanitizedValue = String(value);

          switch (key) {
            case 'bongkarke':
              query.andWhere(
                'consigneedetail.bongkarke',
                'ilike',
                `%${sanitizedValue}%`,
              );
              break;

            default:
              query.andWhere(
                `consigneedetail.${key}`,
                'ilike',
                `%${sanitizedValue}%`,
              );
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }
      const result = await query;
      return {
        data: result,
      };
    } catch (error) {
      console.error('Error in findAll Consignee Detail', error);
      throw new Error(error);
    }
  }
  async delete(id: string, trx: any, modifiedby: string) {
    try {
      const dataDetail = await trx(this.tableName).where('consignee_id', id);

      if (dataDetail.length === 0) {
        return {
          status: 200,
          message: 'Data not found',
          data: [],
        };
      }
      const deletedData: any = [];
      for (const item of dataDetail) {
        const deletedDataItem = await this.utilsService.lockAndDestroy(
          item.id,
          this.tableName,
          'id',
          trx,
        );
        deletedData.push(deletedDataItem);
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE CONSIGNEE DETAIL',
          idtrans: deletedData.id,
          nobuktitrans: deletedData.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby,
        },
        trx,
      );

      return { status: 200, message: 'Data deleted successfully', deletedData };
    } catch (error) {
      console.log('Error deleting data:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }
  findOne(id: string) {
    return `This action returns a #${id} consigneedetail`;
  }

  update(id: string, updateConsigneedetailDto: UpdateConsigneedetailDto) {
    return `This action updates a #${id} consigneedetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} consigneedetail`;
  }
}
