import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreatePackinglistdetailrincianDto } from './dto/create-packinglistdetailrincian.dto';
import { UpdatePackinglistdetailrincianDto } from './dto/update-packinglistdetailrincian.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';

@Injectable()
export class PackinglistdetailrincianService {
  private readonly tableName = 'packinglistdetailrincian';
  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  private readonly logger = new Logger(PackinglistdetailrincianService.name);
  async create(details: any, id: any = 0, trx: any = null) {
    let insertedData = null;
    let data: any = null;
    const tempTableName = `##temp_${Math.random().toString(36).substring(2, 15)}`;

    // Get the column info and create temporary table
    const result = await trx(this.tableName).columnInfo();
    const tableTemp = await this.utilsService.createTempTable(
      this.tableName,
      trx,
      tempTableName,
    );

    const time = this.utilsService.getTime();
    const logData: any[] = [];
    const mainDataToInsert: any[] = [];
    if (details.length === 0) {
      await trx(this.tableName).delete().where('packinglistdetail_id', id);
      return;
    }
    for (data of details) {
      let isDataChanged = false;
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

    // Create temporary table to insert
    await trx.raw(tableTemp);
    // Ensure each item has an idheader
    const processedData = mainDataToInsert.map((item: any) => ({
      ...item,
      packinglistdetail_id: item.packinglistdetail_id ?? id, // Ensure correct field mapping
    }));
    const jsonString = JSON.stringify(processedData);

    const mappingData = Object.keys(processedData[0]).map((key) => [
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
    const updatedData = await trx('packinglistdetailrincian')
      .join(
        `${tempTableName}`,
        'packinglistdetailrincian.id',
        `${tempTableName}.id`,
      )
      .update({
        packinglistdetail_id: trx.raw(`${tempTableName}.packinglistdetail_id`),
        statuspackinglist_id: trx.raw(`${tempTableName}.statuspackinglist_id`),
        keterangan: trx.raw(`${tempTableName}.keterangan`),
        berat: trx.raw(`${tempTableName}.berat`),
        banyak: trx.raw(`${tempTableName}.banyak`),
        info: trx.raw(`${tempTableName}.info`),
        modifiedby: trx.raw(`${tempTableName}.modifiedby`),
        created_at: trx.raw(`${tempTableName}.created_at`),
        updated_at: trx.raw(`${tempTableName}.updated_at`),
      })
      .returning('*')
      .then((result: any) => result[0])
      .catch((error: any) => {
        console.error('Error inserting data:', error);
        throw error;
      });

    // Handle insertion if no update occurs
    const insertedDataQuery = await trx(tempTableName)
      .select([
        'nobukti',
        'statuspackinglist_id',
        'keterangan',
        'banyak',
        'berat',
        'info',
        'modifiedby',
        trx.raw('? as packinglistdetail_id', [id]),
        'created_at',
        'updated_at',
      ])
      .where(`${tempTableName}.id`, '0');

    const getDeleted = await trx(this.tableName)
      .leftJoin(
        `${tempTableName}`,
        'packinglistdetailrincian.id',
        `${tempTableName}.id`,
      )
      .select(
        'packinglistdetailrincian.id',
        'packinglistdetailrincian.nobukti',
        'packinglistdetailrincian.statuspackinglist_id',
        'packinglistdetailrincian.keterangan',
        'packinglistdetailrincian.banyak',
        'packinglistdetailrincian.berat',
        'packinglistdetailrincian.info',
        'packinglistdetailrincian.modifiedby',
        'packinglistdetailrincian.packinglistdetail_id',
        'packinglistdetailrincian.created_at',
        'packinglistdetailrincian.updated_at',
      )
      .whereNull(`${tempTableName}.id`)
      .where('packinglistdetailrincian.packinglistdetail_id', id);

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
        'packinglistdetailrincian.id',
        `${tempTableName}.id`,
      )
      .whereNull(`${tempTableName}.id`)
      .where('packinglistdetailrincian.packinglistdetail_id', id)
      .del();
    if (insertedDataQuery.length > 0) {
      insertedData = await trx('packinglistdetailrincian')
        .insert(await withUuidV7(trx, insertedDataQuery))
        .returning('*')
        .then((result: any) => result[0])
        .catch((error: any) => {
          console.error('Error inserting data:', error);
          throw error;
        });
    }

    await this.logTrailService.create(
      {
        namatabel: this.tableName,
        postingdari: 'PACKING LIST DETAIL RINCIAN',
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
    if (!filters?.nobukti) {
      return {
        data: [],
      };
    }
    // const tempUrl = `##temp_url_${Math.random().toString(36).substring(2, 8)}`;

    // await trx.schema.createTable(tempUrl, (t) => {
    //   t.integer('id').nullable();
    //   t.string('nobukti').nullable();
    //   t.text('link').nullable();
    // });
    // const url = 'jurnalumumheader';

    // await trx(tempUrl).insert(
    //   trx
    //     .select(
    //       'u.id',
    //       'u.nobukti',
    //       trx.raw(`
    //         STRING_AGG(
    //           '<a target="_blank" className="link-color" href="/dashboard/${url}' + ${tandatanya} + 'nobukti=' + u.nobukti + '">' +
    //           '<HighlightWrapper value="' + u.nobukti + '" />' +
    //           '</a>', ','
    //         ) AS link
    //       `),
    //     )
    //     .from(this.tableName + ' as u')
    //     .groupBy('u.id', 'u.nobukti'),
    // );

    try {
      if (!filters?.nobukti) {
        return {
          status: true,
          message: 'Jurnal umum Detail failed to fetch',
          data: [],
        };
      }
      const query = trx
        .from(trx.raw(`${this.tableName} as p`))
        .select(
          'p.id',
          'p.nobukti',
          'p.packinglistdetail_id',
          'p.statuspackinglist_id',
          'p.keterangan',
          'p.banyak',
          'p.berat',
          'p.info',
          'p.modifiedby',
          trx.raw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
        )
        .orderBy('p.created_at', 'desc');

      if (filters?.nobukti) {
        query.where('p.nobukti', filters?.nobukti);
      }
      const searchFields = Object.keys(filters || {}).filter(
        (k) => filters![k],
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
          if (!value) continue;
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          switch (key) {
            default:
              query.andWhere(`p.${key}`, 'like', `%${sanitizedValue}%`);
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
      console.error('Error in findAll Packinglist Detail Rincian', error);
      throw new Error(error);
    }
  }
  async delete(id: string, trx: any, modifiedby: string) {
    try {
      const dataDetail = await trx('packinglistdetailrincian').where(
        'packinglistdetail_id',
        id,
      );
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
          postingdari: 'DELETE PACKING LIST DETAIL RINCIAN',
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
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }
  findOne(id: string) {
    return `This action returns a #${id} packinglistdetailrincian`;
  }

  update(
    id: number,
    updatePackinglistdetailrincianDto: UpdatePackinglistdetailrincianDto,
  ) {
    return `This action updates a #${id} packinglistdetailrincian`;
  }

  remove(id: string) {
    return `This action removes a #${id} packinglistdetailrincian`;
  }
}
