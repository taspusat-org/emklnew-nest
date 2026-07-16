import { Injectable, Logger } from '@nestjs/common';
import { CreateManagermarketingdetailDto } from './dto/create-managermarketingdetail.dto';
import { UpdateManagermarketingdetailDto } from './dto/update-managermarketingdetail.dto';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';

@Injectable()
export class ManagermarketingdetailService {
  private readonly tableName = 'managermarketingdetail';
  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  private readonly logger = new Logger(ManagermarketingdetailService.name);
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
      await trx(this.tableName).delete().where('managermarketing_id', id);
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
      managermarketing_id: item.managermarketing_id ?? id, // Ensure correct field mapping
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

    const updatedData = await trx('managermarketingdetail')
      .join(
        `${tempTableName}`,
        'managermarketingdetail.id',
        `${tempTableName}.id`,
      )
      .update({
        nominalawal: trx.raw(`${tempTableName}.nominalawal`),
        nominalakhir: trx.raw(`${tempTableName}.nominalakhir`),
        persentase: trx.raw(`${tempTableName}.persentase`),
        statusaktif: trx.raw(`${tempTableName}.statusaktif`),
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
        'nominalawal',
        'nominalakhir',
        'persentase',
        'statusaktif',
        'info',
        'modifiedby',
        trx.raw('? as managermarketing_id', [id]),
        'created_at',
        'updated_at',
      ])
      .where(`${tempTableName}.id`, '0');

    const getDeleted = await trx(this.tableName)
      .leftJoin(
        `${tempTableName}`,
        'managermarketingdetail.id',
        `${tempTableName}.id`,
      )
      .select(
        'managermarketingdetail.id',
        'managermarketingdetail.nominalawal',
        'managermarketingdetail.nominalakhir',
        'managermarketingdetail.persentase',
        'managermarketingdetail.statusaktif',
        'managermarketingdetail.info',
        'managermarketingdetail.modifiedby',
        'managermarketingdetail.created_at',
        'managermarketingdetail.updated_at',
        'managermarketingdetail.managermarketing_id',
      )
      .whereNull(`${tempTableName}.id`)
      .where('managermarketingdetail.managermarketing_id', id);

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
        'managermarketingdetail.id',
        `${tempTableName}.id`,
      )
      .whereNull(`${tempTableName}.id`)
      .where('managermarketingdetail.managermarketing_id', id)
      .del();
    if (insertedDataQuery.length > 0) {
      insertedData = await trx('managermarketingdetail')
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
        postingdari: 'MANAGER MARKETING HEADER',
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

  async findAll(id: string, trx: any) {
    const result = await trx
      .from(trx.raw(`${this.tableName} as p`))
      .select([
        'p.id',
        'p.managermarketing_id', // Updated field name
        'p.nominalawal',
        'p.nominalakhir',
        'p.persentase', // Updated field name
        'p.statusaktif',
        'p.info',
        'p.modifiedby',
        trx.raw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
        trx.raw("TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
        'g.memo',
        'g.text',
      ])
      .leftJoin(
        trx.raw('parameter as g'),
        'p.statusaktif',
        'g.id',
      )
      .where('p.managermarketing_id', id) // Updated field name
      .orderBy('p.created_at', 'desc'); // Optional: Order by creation date

    if (!result.length) {
      this.logger.warn(`No Data found for ID: ${id}`);
      return {
        status: false,
        message: 'No data found',
        data: [],
      };
    }

    return {
      status: true,
      message: 'Manager Marketing data fetched successfully',
      data: result,
    };
  }

  update(
    id: string,
    updateManagermarketingdetailDto: UpdateManagermarketingdetailDto,
  ) {
    return `This action updates2 a #${id} managermarketingdetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} managermarketingdetail`;
  }
}
