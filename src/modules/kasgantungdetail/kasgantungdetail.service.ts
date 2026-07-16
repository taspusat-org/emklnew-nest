import { Injectable, Logger } from '@nestjs/common';
import { CreateKasgantungdetailDto } from './dto/create-kasgantungdetail.dto';
import { UpdateKasgantungdetailDto } from './dto/update-kasgantungdetail.dto';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { filter } from 'rxjs';

@Injectable()
export class KasgantungdetailService {
  private readonly tableName = 'kasgantungdetail';
  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  private readonly logger = new Logger(KasgantungdetailService.name);
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
      await trx(this.tableName).delete().where('kasgantung_id', id);
      return;
    }
    for (data of details) {
      let isDataChanged = false;
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

    // Create temporary table to insert
    await trx.raw(tableTemp);
    // Ensure each item has an idheader
    const processedData = mainDataToInsert.map((item: any) => ({
      ...item,
      kasgantung_id: item.kasgantung_id ?? id, // Ensure correct field mapping
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

    // **Update or Insert into 'kasgantungdetail' with correct idheader**
    const updatedData = await trx('kasgantungdetail')
      .join(`${tempTableName}`, 'kasgantungdetail.id', `${tempTableName}.id`)
      .update({
        nobukti: trx.raw(`${tempTableName}.nobukti`),
        keterangan: trx.raw(`${tempTableName}.keterangan`),
        nominal: trx.raw(`${tempTableName}.nominal`),
        info: trx.raw(`${tempTableName}.info`),
        modifiedby: trx.raw(`${tempTableName}.modifiedby`),
        editing_by: trx.raw(`${tempTableName}.editing_by`),
        editing_at: trx.raw(`${tempTableName}.editing_at`),
        kasgantung_id: trx.raw(`${tempTableName}.kasgantung_id`),
        created_at: trx.raw(`${tempTableName}.created_at`),
        updated_at: trx.raw(`${tempTableName}.updated_at`),
        pengeluarandetail_id: trx.raw(`${tempTableName}.pengeluarandetail_id`),
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
        'keterangan',
        'nominal',
        'info',
        'modifiedby',
        'editing_by',
        'editing_at',
        trx.raw('? as kasgantung_id', [id]),
        'created_at',
        'updated_at',
        'pengeluarandetail_id',
      ])
      .where(`${tempTableName}.id`, '0');

    const getDeleted = await trx(this.tableName)
      .leftJoin(
        `${tempTableName}`,
        'kasgantungdetail.id',
        `${tempTableName}.id`,
      )
      .select(
        'kasgantungdetail.id',
        'kasgantungdetail.nobukti',
        'kasgantungdetail.keterangan',
        'kasgantungdetail.nominal',
        'kasgantungdetail.info',
        'kasgantungdetail.modifiedby',
        'kasgantungdetail.editing_by',
        'kasgantungdetail.editing_at',
        'kasgantungdetail.created_at',
        'kasgantungdetail.updated_at',
        'kasgantungdetail.pengeluarandetail_id',
        'kasgantungdetail.kasgantung_id',
      )
      .whereNull(`${tempTableName}.id`)
      .where('kasgantungdetail.kasgantung_id', id);

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
        'kasgantungdetail.id',
        `${tempTableName}.id`,
      )
      .whereNull(`${tempTableName}.id`)
      .where('kasgantungdetail.kasgantung_id', id)
      .del();
    if (insertedDataQuery.length > 0) {
      insertedData = await trx('kasgantungdetail')
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
        postingdari: 'PENGEMBALIAN KAS GANTUNG HEADER',
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
    try {
      if (!filters?.nobukti) {
        return {
          status: true,
          message: 'Kas Gantung Detail failed to fetch',
          data: [],
        };
      }
      const query = trx(`${this.tableName} as p`)
        .select(
          'p.id',
          'p.kasgantung_id', // Updated field name
          'p.nobukti',
          'p.keterangan',
          'p.nominal', // Updated field name
          'p.info',
          'p.modifiedby',
          'p.editing_by',
          trx.raw("TO_CHAR(p.editing_at, 'DD-MM-YYYY HH24:MI:SS') as editing_at"),
          trx.raw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'p.pengeluarandetail_id',
        )
        .orderBy('p.created_at', 'desc');
      if (filters?.nobukti) {
        query.where('p.nobukti', filters?.nobukti);
      }
      if (search) {
        const sanitizedValue = String(search).replace(/\[/g, '[[]');
        query.where((builder) => {
          builder
            .orWhere('p.nobukti', 'like', `%${sanitizedValue}%`)
            .orWhere('p.keterangan', 'like', `%${sanitizedValue}%`)
            .orWhere('p.nominal', 'like', `%${sanitizedValue}%`);
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (!value) continue;
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          switch (key) {
            case 'tglbukti':
              query.andWhere('p.tglbukti', 'like', sanitizedValue);
              break;

            case 'nominal':
              query.andWhere('p.nominal', 'like', `%${sanitizedValue}%`);
              break;

            default:
              query.andWhere(`p.${key}`, 'like', `%${sanitizedValue}%`);
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }

      const result = await query;

      if (!result.length) {
        this.logger.warn(`No Data found`);
        return {
          status: false,
          message: 'No data found',
          data: [],
        };
      }

      return {
        status: true,
        message: 'Kas Gantung Detail data fetched successfully',
        data: result,
      };
    } catch (error) {
      console.error('Error in findAll Kas Gantung Detail', error);
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} kasgantungdetail`;
  }

  update(id: string, updateKasgantungdetailDto: UpdateKasgantungdetailDto) {
    return `This action updates a #${id} kasgantungdetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} kasgantungdetail`;
  }
}
