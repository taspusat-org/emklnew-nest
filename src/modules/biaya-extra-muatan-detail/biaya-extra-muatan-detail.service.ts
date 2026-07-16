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
    try {
      let insertedData = null;
      const logData: any[] = [];
      const mainDataToInsert: any[] = [];
      const time = this.utilsService.getTime();
      const tempTableName = `##temp_${Math.random().toString(36).substring(2, 15)}`;
      const tableTemp = await this.utilsService.createTempTable(
        this.tableName,
        trx,
        tempTableName,
      );

      if (details.length === 0) {
        await trx(this.tableName).delete().where('biayaextra_id', id);
        return;
      }

      for (const data of details) {
        let isDataChanged = false;

        // Uppercase hanya kolom teks manusiawi. id (PK), biayaextra_id/
        // groupbiayaextra_id (FK), status*, dan *_nobukti adalah UUID/kunci
        // bertipe text (case-sensitive); blanket uppercase meng-corrupt id.
        ['keterangan'].forEach((field) => {
          if (typeof data[field] === 'string') {
            data[field] = data[field].toUpperCase();
          }
        });

        // Check if the data has an id (existing record)
        if (data.id) {
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
          // New record: Set timestamps
          const newTimestamps = {
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

      // **Update or Insert into 'packinglistdetailrincian' with correct idheader**
      const updatedData = await trx(this.tableName)
        .join(`${tempTableName}`, `${this.tableName}.id`, `${tempTableName}.id`)
        .update({
          nobukti: trx.raw(`${tempTableName}.nobukti`),
          biayaextra_id: trx.raw(`${tempTableName}.biayaextra_id`),
          orderanmuatan_nobukti: trx.raw(
            `${tempTableName}.orderanmuatan_nobukti`,
          ),
          estimasi: trx.raw(`${tempTableName}.estimasi`),
          nominal: trx.raw(`${tempTableName}.nominal`),
          statustagih: trx.raw(`${tempTableName}.statustagih`),
          nominaltagih: trx.raw(`${tempTableName}.nominaltagih`),
          keterangan: trx.raw(`${tempTableName}.keterangan`),
          groupbiayaextra_id: trx.raw(`${tempTableName}.groupbiayaextra_id`),
          info: trx.raw(`${tempTableName}.info`),
          modifiedby: trx.raw(`${tempTableName}.modifiedby`),
          created_at: trx.raw(`${tempTableName}.created_at`),
          updated_at: trx.raw(`${tempTableName}.updated_at`),
        })
        .returning('*')
        .then((result: any) => result[0])
        .catch((error: any) => {
          console.error('Error updated data biaya extra muatan detail:', error);
          throw error;
        });

      // Handle insertion if no update occurs
      const insertedDataQuery = await trx(tempTableName)
        .select([
          'nobukti',
          'biayaextra_id',
          'orderanmuatan_nobukti',
          'estimasi',
          'nominal',
          'statustagih',
          'nominaltagih',
          'keterangan',
          'groupbiayaextra_id',
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
          'u.biayaextra_id',
          'u.orderanmuatan_nobukti',
          'u.estimasi',
          'u.nominal',
          'u.statustagih',
          'u.nominaltagih',
          'u.keterangan',
          'u.groupbiayaextra_id',
          'u.info',
          'u.modifiedby',
          'u.created_at',
          'u.updated_at',
        )
        .whereNull(`${tempTableName}.id`)
        .where('u.biayaextra_id', id);

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
        .where(`${this.tableName}.biayaextra_id`, id)
        .del();

      if (insertedDataQuery.length > 0) {
        insertedData = await trx(this.tableName)
          .insert(await withUuidV7(trx, insertedDataQuery))
          .returning('*')
          .then((result: any) => result[0])
          .catch((error: any) => {
            console.error(
              'Error inserting data biaya extra muatan detail:',
              error,
            );
            throw error;
          });
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

      console.log(
        'RESULT BIAYA EXTRA MUATAN DETAIL insertedData',
        insertedData,
        'updatedData',
        updatedData,
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
      let { page, limit } = pagination ?? {};
      page = page ?? 1;
      limit = limit ?? 0;

      const query = trx(`${this.tableName} as u`)
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
        .leftJoin('parameter as p', 'u.statustagih', 'p.id')
        .leftJoin('groupbiayaextra as q', 'u.groupbiayaextra_id', 'q.id')
        .where('biayaextra_id', id);

      const excludeSearchKeys = ['statustagih_text'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (field === 'groupbiayaextra_text') {
              qb.orWhere(`q.keterangan`, 'like', `%${sanitized}%`);
            } else {
              qb.orWhere(`u.${field}`, 'like', `%${sanitized}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');
          if (value) {
            if (key === 'statustagih_text') {
              query.andWhere(`p.id`, '=', sanitizedValue);
            } else if (key === 'groupbiayaextra_text') {
              query.andWhere(`q.keterangan`, 'like', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'statustagih_text') {
          const memoExpr = '(CASE WHEN p.memo IS JSON THEN p.memo::jsonb END)';
          query.orderByRaw(
            `JSON_VALUE(${memoExpr}, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'groupbiayaextra_text') {
          query.orderBy(`q.keterangan`, sort.sortDirection);
        } else {
          query.orderBy(sort.sortBy, sort.sortDirection);
        }
      }

      const result = await query;

      return {
        data: result,
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
