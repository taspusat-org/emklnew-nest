import {
  Injectable,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { CreateConsigneehargajualDto } from './dto/create-consigneehargajual.dto';
import { UpdateConsigneehargajualDto } from './dto/update-consigneehargajual.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';

@Injectable()
export class ConsigneehargajualService {
  private readonly tableName = 'consigneehargajual';
  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  async create(details: any, id: any = 0, trx: any = null) {
    // Rewrite Postgres: tanpa temp table + OPENJSON. knex-pg tidak mendukung
    // UPDATE/DELETE dengan JOIN, jadi upsert dilakukan langsung: update
    // per-baris, hapus baris yang tak dikirim via whereNotIn, insert baris
    // baru dengan withUuidV7.
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
          container_id: row.container_id,
          nominal: row.nominal,
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
        'container_id',
        'nominal',
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
        container_id: r.container_id,
        nominal: r.nominal,
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
        postingdari: 'CONSIGNEE HARGA JUAL',
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
            `${this.tableName} as consigneehargajual`,
          ),
        )
        .select(
          'consigneehargajual.id',
          'consigneehargajual.consignee_id',
          'consigneehargajual.container_id',
          'consigneehargajual.nominal',

          'consigneehargajual.info',
          'consigneehargajual.modifiedby',
          'p1.nama as container_nama',
          trx.raw(
            "TO_CHAR(consigneehargajual.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(consigneehargajual.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
        )
        .leftJoin('container as p1', 'consigneehargajual.container_id', 'p1.id')
        .orderBy('consigneehargajual.created_at', 'desc');

      if (filters?.consignee_id) {
        query.where('consigneehargajual.consignee_id', filters?.consignee_id);
      }
      const excludeSearchKeys = ['consignee_id'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k) && filters![k],
      );
      if (search) {
        const sanitized = String(search).trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (['created_at', 'updated_at'].includes(field)) {
              qb.orWhereRaw(
                "TO_CHAR(consigneehargajual.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?",
                [field, `%${sanitized}%`],
              );
            } else if (field === 'container_nama') {
              qb.orWhere('p1.nama', 'ilike', `%${sanitized}%`);
            } else {
              qb.orWhere(
                `consigneehargajual.${field}`,
                'ilike',
                `%${sanitized}%`,
              );
            }
          });
        });
      }
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value);

          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw(
                "TO_CHAR(consigneehargajual.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?",
                [key, `%${sanitizedValue}%`],
              );
            } else if (key === 'container_nama') {
              query.andWhere('p1.nama', 'ilike', `%${sanitizedValue}%`);
            } else {
              query.andWhere(
                `consigneehargajual.${key}`,
                'ilike',
                `%${sanitizedValue}%`,
              );
            }
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort.sortBy === 'container_nama') {
          query.orderBy('p1.nama', sort.sortDirection);
        } else {
          query.orderBy(sort.sortBy, sort.sortDirection);
        }
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
          postingdari: 'DELETE CONSIGNEE HARGA JUAL',
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
    return `This action returns a #${id} consigneehargajual`;
  }

  update(id: string, updateConsigneehargajualDto: UpdateConsigneehargajualDto) {
    return `This action updates a #${id} consigneehargajual`;
  }

  remove(id: string) {
    return `This action removes a #${id} consigneehargajual`;
  }
}
