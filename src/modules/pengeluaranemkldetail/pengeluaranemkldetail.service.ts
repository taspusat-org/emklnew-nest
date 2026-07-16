import { Injectable, Logger } from '@nestjs/common';
import { CreatePengeluaranemkldetailDto } from './dto/create-pengeluaranemkldetail.dto';
import { UpdatePengeluaranemkldetailDto } from './dto/update-pengeluaranemkldetail.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';

@Injectable()
export class PengeluaranemkldetailService {
  private readonly tableName = 'pengeluaranemkldetail';
  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  private readonly logger = new Logger(PengeluaranemkldetailService.name);
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
      await trx(this.tableName).delete().where('pengeluaranemklheader_id', id);
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
      pengeluaranemklheader_id: item.pengeluaranemklheader_id ?? id, // Ensure correct field mapping
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

    // **Update or Insert into 'pengeluaranemkldetail' with correct idheader**
    const updatedData = await trx('pengeluaranemkldetail')
      .join(
        `${tempTableName}`,
        'pengeluaranemkldetail.id',
        `${tempTableName}.id`,
      )
      .update({
        nobukti: trx.raw(`pengeluaranemkldetail.nobukti`),
        noseal: trx.raw(`${tempTableName}.noseal`),
        keterangan: trx.raw(`${tempTableName}.keterangan`),
        nominal: trx.raw(`${tempTableName}.nominal`),
        info: trx.raw(`${tempTableName}.info`),
        modifiedby: trx.raw(`${tempTableName}.modifiedby`),
        pengeluaranemklheader_id: trx.raw(
          `${tempTableName}.pengeluaranemklheader_id`,
        ),
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
        'noseal',
        'keterangan',
        'nominal',
        'info',
        'modifiedby',
        trx.raw('? as pengeluaranemklheader_id', [id]),
        'created_at',
        'updated_at',
      ])
      .where(`${tempTableName}.id`, '0');

    const getDeleted = await trx(this.tableName)
      .leftJoin(
        `${tempTableName}`,
        'pengeluaranemkldetail.id',
        `${tempTableName}.id`,
      )
      .select(
        'pengeluaranemkldetail.id',
        'pengeluaranemkldetail.nobukti',
        'pengeluaranemkldetail.noseal',
        'pengeluaranemkldetail.keterangan',
        'pengeluaranemkldetail.nominal',
        'pengeluaranemkldetail.info',
        'pengeluaranemkldetail.modifiedby',
        'pengeluaranemkldetail.created_at',
        'pengeluaranemkldetail.updated_at',
        'pengeluaranemkldetail.pengeluaranemklheader_id',
      )

      .whereNull(`${tempTableName}.id`)
      .where('pengeluaranemkldetail.pengeluaranemklheader_id', id);

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
        'pengeluaranemkldetail.id',
        `${tempTableName}.id`,
      )
      .whereNull(`${tempTableName}.id`)
      .where('pengeluaranemkldetail.pengeluaranemklheader_id', id)
      .del();
    if (insertedDataQuery.length > 0) {
      insertedData = await trx('pengeluaranemkldetail')
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
        postingdari: 'PENGELUARAN EMKL DETAIL',
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
          data: [],
        };
      }
      const query = trx
        .from(trx.raw(`${this.tableName} as p`))
        .select(
          'p.id',
          'p.pengeluaranemklheader_id',
          'p.nobukti',
          'p.nominal',
          'p.keterangan',
          'p.pengeluaranemkl_nobukti',
          'p.pengeluaranemkl_nobukti',
          'p.info',
          'p.modifiedby',
          trx.raw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'p.noseal',
        )
        .orderBy('p.created_at', 'desc');
      if (filters?.nobukti) {
        query.where('p.nobukti', filters?.nobukti);
      }
      const excludeSearchKeys = ['tglDari', 'tglSampai', 'nobukti'];
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
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw("TO_CHAR(p.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else {
              query.andWhere(`p.${key}`, 'like', `%${sanitizedValue}%`);
            }
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
      console.error('Error in findAll Pengeluaran EMKL Detail', error);
      throw new Error(error);
    }
  }
}
