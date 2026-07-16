import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateBiayaMuatanDetailDto } from './dto/create-biaya-muatan-detail.dto';
import { UpdateBiayaMuatanDetailDto } from './dto/update-biaya-muatan-detail.dto';
import { withUuidV7, tandatanya, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class BiayaMuatanDetailService {
  private readonly tableName: string = 'biayamuatandetail';

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
        await trx(this.tableName).delete().where('biaya_id', id);
        return;
      }

      for (const data of details) {
        let isDataChanged = false;

        // Uppercase hanya kolom teks manusiawi. id (PK), biaya_id/biayamuatan_id/
        // biayaemkl_id (FK), dan *_nobukti adalah UUID/kunci bertipe text
        // (case-sensitive); blanket uppercase meng-corrupt id → lookup-by-id gagal.
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

      // **Update or Insert into 'biayamuatandetail' with correct idheader**
      const updatedData = await trx(this.tableName)
        .join(`${tempTableName}`, `${this.tableName}.id`, `${tempTableName}.id`)
        .update({
          nobukti: trx.raw(`${tempTableName}.nobukti`),
          biaya_id: trx.raw(`${tempTableName}.biaya_id`),
          orderanmuatan_nobukti: trx.raw(
            `${tempTableName}.orderanmuatan_nobukti`,
          ),
          estimasi: trx.raw(`${tempTableName}.estimasi`),
          nominal: trx.raw(`${tempTableName}.nominal`),
          keterangan: trx.raw(`${tempTableName}.keterangan`),
          biayaextra_nobukti: trx.raw(`${tempTableName}.biayaextra_nobukti`),
          biayaextra_nobuktijson: trx.raw(
            `${tempTableName}.biayaextra_nobuktijson`,
          ),
          info: trx.raw(`${tempTableName}.info`),
          modifiedby: trx.raw(`${tempTableName}.modifiedby`),
          created_at: trx.raw(`${tempTableName}.created_at`),
          updated_at: trx.raw(`${tempTableName}.updated_at`),
        })
        .returning('*')
        .then((result: any) => result[0])
        .catch((error: any) => {
          console.error('Error updated data biaya muatan detail:', error);
          throw error;
        });

      // Handle insertion if no update occurs
      const insertedDataQuery = await trx(tempTableName)
        .select([
          'nobukti',
          'biaya_id',
          'orderanmuatan_nobukti',
          'estimasi',
          'nominal',
          'keterangan',
          'biayaextra_nobukti',
          'biayaextra_nobuktijson',
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
          'u.biaya_id',
          'u.orderanmuatan_nobukti',
          'u.estimasi',
          'u.nominal',
          'u.keterangan',
          'u.biayaextra_nobukti',
          'u.biayaextra_nobuktijson',
          'u.info',
          'u.modifiedby',
          'u.created_at',
          'u.updated_at',
        )
        .whereNull(`${tempTableName}.id`)
        .where('u.biaya_id', id);

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
        .where(`${this.tableName}.biaya_id`, id)
        .del();

      if (insertedDataQuery.length > 0) {
        insertedData = await trx(this.tableName)
          .insert(await withUuidV7(trx, insertedDataQuery))
          .returning('*')
          .then((result: any) => result[0])
          .catch((error: any) => {
            console.error('Error inserting data biaya muatan detail:', error);
            throw error;
          });
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD BIAYA MUATAN DETAIL',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(finalData),
          modifiedby: details[0].modifiedby || 'unknown',
        },
        trx,
      );

      console.log(
        'RESULT BIAYA MUATAN DETAIL insertedData',
        insertedData,
        'updatedData',
        updatedData,
      );

      return updatedData || insertedData;
    } catch (error) {
      console.error(
        'Error process creating biaya muatan detail in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process creating biaya muatan detail in service',
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
      const url = 'biaya-extra-header';
      const urlOrderan = 'orderanmuatan';

      // trx.raw(`
      //   STRING_AGG(json.BIAYAEXTRA_NOBUKTI, ', ')
      //   AS biayaextra_nobuktijson
      // `),

      const tempBiayaExtraJson = `##temp_json_url_${Math.random().toString(36).substring(2, 8)}`;
      const tempUrl = `##temp_url_${Math.random().toString(36).substring(2, 8)}`;
      const tempUrlOrderan = `##temp_url_orderan_${Math.random().toString(36).substring(2, 8)}`;

      await trx.schema.createTable(tempBiayaExtraJson, (t) => {
        t.integer('id').nullable();
        t.string('biayaextra_nobuktijson').nullable();
        t.text('json_link').nullable();
      });

      await trx.schema.createTable(tempUrl, (t) => {
        t.integer('id').nullable();
        t.text('link').nullable();
      });

      await trx.schema.createTable(tempUrlOrderan, (t) => {
        t.integer('id').nullable();
        t.text('link_orderan').nullable();
      });

      await trx(tempBiayaExtraJson).insert(
        trx
          .select(
            'u.id',
            trx.raw(`
              STRING_AGG(json.BIAYAEXTRA_NOBUKTI, ', ') 
              AS biayaextra_nobuktijson
            `),
            trx.raw(`
              STRING_AGG(
                '<a target="_blank" className="link-color" href="/dashboard/${url}' + ${tandatanya} + 'biayaextra_nobukti=' + json.BIAYAEXTRA_NOBUKTI + '">' +
                '<HighlightWrapper value="' + json.BIAYAEXTRA_NOBUKTI + '" />' +
                '</a>', ','
              ) AS json_link
            `),
          )
          .from(`${this.tableName} as u`)
          .joinRaw(
            `
            CROSS APPLY OPENJSON(u.biayaextra_nobuktijson)
            WITH (
              BIAYAEXTRA_NOBUKTI NVARCHAR(100) '$.BIAYAEXTRA_NOBUKTI'
            ) AS json
          `,
          )
          .groupBy('u.id'),
      );

      await trx(tempUrl).insert(
        trx
          .select(
            'u.id',
            trx.raw(`
              STRING_AGG(
                '<a target="_blank" className="link-color" href="/dashboard/${url}' + ${tandatanya} + 'biayaextra_nobukti=' + u.biayaextra_nobukti + '">' +
                '<HighlightWrapper value="' + u.biayaextra_nobukti + '" />' +
                '</a>', ','
              ) AS link
            `),
          )
          .from(`${this.tableName} as u`)
          .groupBy('u.id'),
      );

      await trx(tempUrlOrderan).insert(
        trx
          .select(
            'u.id',
            trx.raw(`
              STRING_AGG(
                '<a target="_blank" className="link-color" href="/dashboard/${urlOrderan}' + ${tandatanya} + 'orderan_nobukti=' + u.orderanmuatan_nobukti + '">' +
                '<HighlightWrapper value="' + u.orderanmuatan_nobukti + '" />' +
                '</a>', ','
              ) AS link
            `),
          )
          .from(`${this.tableName} as u`)
          .groupBy('u.id'),
      );

      const query = trx(`${this.tableName} as u`)
        .select(
          'u.id',
          'u.nobukti',
          'u.biaya_id',
          'u.orderanmuatan_nobukti',
          'u.estimasi',
          'u.nominal',
          'u.keterangan',
          'u.biayaextra_nobukti',
          'u.biayaextra_nobuktijson',
          'json.biayaextra_nobuktijson as biayaextra_nobuktistring',
          'json.json_link',
          'tempUrl.link',
          'tempUrlOrderan.link_orderan',
          'biayaextraheader.id as biayaextra_id',
          trx.raw("TO_CHAR(orderanheader.tglbukti, 'DD-MM-YYYY') as tgljob"),
          'orderanmuatan.id as orderanmuatan_id',
          'orderanmuatan.nocontainer',
          'orderanmuatan.noseal',
          'p.keterangan as lokasistuffing_nama',
          'q.nama as shipper_nama',
          'container.nama as container_nama',
        )
        .leftJoin(`${tempBiayaExtraJson} as json`, 'u.id', 'json.id')
        .leftJoin(`${tempUrl} as tempUrl`, 'u.id', 'tempUrl.id')
        .leftJoin(
          `${tempUrlOrderan} as tempUrlOrderan`,
          'u.id',
          'tempUrlOrderan.id',
        )
        .leftJoin(
          'biayaextraheader',
          'u.biayaextra_nobukti',
          'biayaextraheader.nobukti',
        )
        .leftJoin(
          'orderanmuatan',
          'u.orderanmuatan_nobukti',
          'orderanmuatan.nobukti',
        )
        .leftJoin(
          'orderanheader',
          'orderanmuatan.orderan_id',
          'orderanheader.id',
        )
        .leftJoin('hargatrucking as p', 'orderanmuatan.lokasistuffing', 'p.id')
        .leftJoin('shipper as q', 'orderanmuatan.shipper_id', 'q.id')
        .leftJoin('container', 'orderanmuatan.container_id', 'container.id')
        .where('biaya_id', id);

      const excludeSearchKeys = ['test'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (field === 'biayaextra_nobukti') {
              qb.orWhere(`u.biayaextra_nobukti`, 'like', `%${sanitized}%`);
              qb.orWhere(
                `json.biayaextra_nobuktijson`,
                'like',
                `%${sanitized}%`,
              );
            } else {
              qb.orWhere(`u.${field}`, 'like', `%${sanitized}%`);
            }
          });
        });
      }

      if (filters) {
        Object.entries(filters)
          .filter(([key, value]) => !excludeSearchKeys.includes(key) && value)
          .forEach(([key, value]) => {
            const sanitizedValue = String(value).replace(/\[/g, '[[]');

            if (key === 'biayaextra_nobukti') {
              // query.andWhere(`p.nama`, 'like', `%${sanitizedValue}%`);
              query.andWhere((qb) => {
                qb.orWhere(
                  `u.biayaextra_nobukti`,
                  'like',
                  `%${sanitizedValue}%`,
                );
                qb.orWhere(
                  `json.biayaextra_nobuktijson`,
                  'like',
                  `%${sanitizedValue}%`,
                );
              });
            } else {
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
            }
          });
      }

      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }

      const result = await query;
      console.log('result', result);

      return {
        data: result,
      };
    } catch (error) {
      console.error('Error to findAll biaya muatan detail in service', error);
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} biayaMuatanDetail`;
  }

  update(id: string, updateBiayaMuatanDetailDto: UpdateBiayaMuatanDetailDto) {
    return `This action updates a #${id} biayaMuatanDetail`;
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
          postingdari: 'DELETE BIAYA MUATAN DETAIL',
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
      console.log('Error deleting biaya muatan detail in service:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete biaya muatan detail in service',
      );
    }
  }
}
