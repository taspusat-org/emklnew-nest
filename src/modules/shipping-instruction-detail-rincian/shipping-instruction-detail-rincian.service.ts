import {
  Injectable,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { CreateShippingInstructionDetailRincianDto } from './dto/create-shipping-instruction-detail-rincian.dto';
import { UpdateShippingInstructionDetailRincianDto } from './dto/update-shipping-instruction-detail-rincian.dto';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class ShippingInstructionDetailRincianService {
  private readonly tableName: string = 'shippinginstructiondetailrincian';

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}

  async create(
    detailsrincian: any,
    shippinginstructiondetail_id: number,
    trx: any,
  ) {
    try {
      let insertedData = null;
      // let data: any = null;
      const logData: any[] = [];
      const mainDataToInsert: any[] = [];
      const time = this.utilsService.getTime();
      const tempTableName = `##temp_${Math.random().toString(36).substring(2, 15)}`;
      const tableTemp = await this.utilsService.createTempTable(
        this.tableName,
        trx,
        tempTableName,
      );

      if (detailsrincian.length === 0) {
        await trx(this.tableName)
          .delete()
          .where('shippinginstructiondetail_id', shippinginstructiondetail_id);
        return;
      }

      for (const data of detailsrincian) {
        let isDataChanged = false;

        // Uppercase hanya kolom teks manusiawi. id (PK), shippinginstructiondetail_id
        // (FK), dan *_nobukti adalah UUID/kunci bertipe text (case-sensitive);
        // blanket uppercase meng-corrupt id sehingga lookup-by-id gagal.
        ['comodity', 'keterangan'].forEach((field) => {
          if (typeof data[field] === 'string') {
            data[field] = data[field].toUpperCase();
          }
        });

        // id kosong atau '0' = baris baru; pengirim antar-service memakai '0'.
        if (data.id && String(data.id) !== '0') {
          const existingData = await trx(this.tableName)
            .where('id', data.id)
            .first();

          if (existingData) {
            const createdAt = {
              created_at: existingData.created_at,
              updated_at: existingData.updated_at,
            };
            Object.assign(data, createdAt);

            if (this.utilsService.hasChanges(data, existingData)) {
              data.updated_at = time;
              isDataChanged = true;
              data.aksi = 'UPDATE';
            }
          }
        } else {
          const newTimestamps = {
            // New record: Set timestamps
            created_at: time,
            updated_at: time,
          };
          Object.assign(data, newTimestamps);
          isDataChanged = true;
          data.aksi = 'CREATE';
        }

        if (!isDataChanged) {
          data.aksi = 'NO UPDATE';
        }

        const { aksi, ...dataForInsert } = data;
        mainDataToInsert.push(dataForInsert);
        logData.push({
          ...data,
          created_at: time,
        });
      }

      await trx.raw(tableTemp);

      const jsonString = JSON.stringify(mainDataToInsert);
      const mappingData = Object.keys(mainDataToInsert[0]).map((key) => [
        'value',
        `$.${key}`,
        key,
      ]);

      const openJson = await trx
        .from(trx.raw('OPENJSON(?)', [jsonString]))
        .jsonExtract(mappingData)
        .as('jsonData');

      // Insert into temp table
      await trx(tempTableName).insert(openJson);

      const updatedData = await trx(this.tableName)
        .join(`${tempTableName}`, `${this.tableName}.id`, `${tempTableName}.id`)
        .update({
          nobukti: trx.raw(`${tempTableName}.nobukti`),
          shippinginstructiondetail_id: trx.raw(
            `${tempTableName}.shippinginstructiondetail_id`,
          ),
          shippinginstructiondetail_nobukti: trx.raw(
            `${tempTableName}.shippinginstructiondetail_nobukti`,
          ),
          orderanmuatan_nobukti: trx.raw(
            `${tempTableName}.orderanmuatan_nobukti`,
          ),
          comodity: trx.raw(`${tempTableName}.comodity`),
          keterangan: trx.raw(`${tempTableName}.keterangan`),
          modifiedby: trx.raw(`${tempTableName}.modifiedby`),
          created_at: trx.raw(`${tempTableName}.created_at`),
          updated_at: trx.raw(`${tempTableName}.updated_at`),
        })
        .returning('*')
        .then((result: any) => result[0])
        .catch((error: any) => {
          console.error(
            'Error inserting data shipping instruction detail rincian in servoce',
            error,
            error.message,
          );
          throw error;
        });

      const insertedDataQuery = await trx(tempTableName)
        .select([
          'nobukti',
          'shippinginstructiondetail_id',
          'shippinginstructiondetail_nobukti',
          'orderanmuatan_nobukti',
          'comodity',
          'keterangan',
          'modifiedby',
          'created_at',
          'updated_at',
        ])
        .where(`${tempTableName}.id`, '0');

      const getDeleted = await trx(`${this.tableName} as u`)
        .leftJoin(`${tempTableName}`, 'u.id', `${tempTableName}.id`)
        .select(
          'u.nobukti',
          'u.shippinginstructiondetail_id',
          'u.shippinginstructiondetail_nobukti',
          'u.orderanmuatan_nobukti',
          'u.comodity',
          'u.keterangan',
          'u.modifiedby',
          'u.created_at',
          'u.updated_at',
        )
        .whereNull(`${tempTableName}.id`)
        .where('u.shippinginstructiondetail_id', shippinginstructiondetail_id);

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
        .where(
          `${this.tableName}.shippinginstructiondetail_id`,
          shippinginstructiondetail_id,
        )
        .del();

      if (insertedDataQuery.length > 0) {
        insertedData = await trx(this.tableName)
          .insert(await withUuidV7(trx, insertedDataQuery))
          .returning('*')
          .then((result: any) => result[0])
          .catch((error: any) => {
            console.error(
              'Error inserting data to shipping instruction detail rincian in service:',
              error,
            );
            throw error;
          });
      }
      console.log('insertedData', insertedData, 'updatedData', updatedData);

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD SHIPPING INSTRUCTION DETAIL RINCIAN',
          idtrans: shippinginstructiondetail_id,
          nobuktitrans: shippinginstructiondetail_id,
          aksi: 'EDIT',
          datajson: JSON.stringify(finalData),
          modifiedby: detailsrincian[0].modifiedby,
        },
        trx,
      );

      return updatedData || insertedData;
    } catch (error) {
      console.error(
        'Error process creating shipping instruction detail rincian in service:',
        error.message,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process creating shipping instruction detail rincian in service',
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
          'p.nobukti',
          'p.shippinginstructiondetail_id',
          'p.shippinginstructiondetail_nobukti',
          'p.orderanmuatan_nobukti',
          'p.comodity',
          'p.keterangan',
          'q.nocontainer',
          'q.noseal',
          'r.nama as shipper_nama',
        )
        .leftJoin('orderanmuatan as q', 'p.orderanmuatan_nobukti', 'q.nobukti')
        .leftJoin('shipper as r', 'q.shipper_id', 'r.id')
        .where('shippinginstructiondetail_id', id);

      const excludeSearchKeys = [''];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k) && filters![k],
      );
      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            qb.orWhere(`p.${field}`, 'like', `%${sanitized}%`);
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');
          if (value) {
            if (key === 'detail_nobukti') {
              query.andWhere(
                `p.shippinginstructiondetail_nobukti`,
                'like',
                `%${sanitizedValue}%`,
              );
            } else {
              query.andWhere(`p.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'detail_nobukti') {
          query.orderBy(
            'p.shippinginstructiondetail_nobukti',
            sort.sortDirection,
          );
        } else {
          query.orderBy(sort.sortBy, sort.sortDirection);
        }
      }

      const result = await query;
      console.log('result SI RINCIAN', result);

      return {
        data: result,
      };
    } catch (error) {
      console.error(
        'Error to findAll Schedule detail rincian in service',
        error,
      );
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} shippingInstructionDetailRincian`;
  }

  update(
    id: number,
    updateShippingInstructionDetailRincianDto: UpdateShippingInstructionDetailRincianDto,
  ) {
    return `This action updates a #${id} shippingInstructionDetailRincian`;
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
          postingdari: 'DELETE SHIPPING INSTRUCTION DETAIL RINCIAN',
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
        'Error deleting data shipping instruction detail rincian in service:',
        error,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete data shipping instruction detail rincian in service',
      );
    }
  }
}
