import { Injectable, Logger } from '@nestjs/common';
import { CreateHutangdetailDto } from './dto/create-hutangdetail.dto';
import { UpdateHutangdetailDto } from './dto/update-hutangdetail.dto';
import { withUuidV7, UtilsService, tandatanya  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class HutangdetailService {
  private readonly tableName = 'hutangdetail';
  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  private readonly logger = new Logger(HutangdetailService.name);
  async create(details: any, id: any = 0, trx: any = null) {
    let insertedData = null;
    let data: any = null;
    const tempTableName = `##temp_${Math.random().toString(36).substring(2, 15)}`;

    const tableTemp = await this.utilsService.createTempTable(
      this.tableName,
      trx,
      tempTableName,
    );

    const time = this.utilsService.getTime();
    const logData: any[] = [];
    const mainDataToInsert: any[] = [];
    if (details.length === 0) {
      await trx(this.tableName).delete().where('hutang_id', id);
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
      hutang_id: item.hutang_id ?? id, // Ensure correct field mapping
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
    const updatedData = await trx('hutangdetail')
      .join(`${tempTableName}`, 'hutangdetail.id', `${tempTableName}.id`)
      .update({
        coa: trx.raw(`${tempTableName}.coa`),
        keterangan: trx.raw(`${tempTableName}.keterangan`),
        nominal: trx.raw(`${tempTableName}.nominal`),
        dpp: trx.raw(`${tempTableName}.dpp`),
        noinvoiceemkl: trx.raw(`${tempTableName}.noinvoiceemkl`),
        tglinvoiceemkl: trx.raw(`${tempTableName}.tglinvoiceemkl`),
        nofakturpajakemkl: trx.raw(`${tempTableName}.nofakturpajakemkl`),
        info: trx.raw(`${tempTableName}.info`),
        modifiedby: trx.raw(`${tempTableName}.modifiedby`),
        hutang_id: trx.raw(`${tempTableName}.hutang_id`),
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
        'coa',
        'keterangan',
        'nominal',
        'dpp',
        'noinvoiceemkl',
        'tglinvoiceemkl',
        'nofakturpajakemkl',
        'info',
        'modifiedby',
        trx.raw('? as hutang_id', [id]),
        'created_at',
        'updated_at',
      ])
      .where(`${tempTableName}.id`, '0');

    const getDeleted = await trx(this.tableName)
      .leftJoin(`${tempTableName}`, 'hutangdetail.id', `${tempTableName}.id`)
      .select(
        'hutangdetail.id',
        'hutangdetail.nobukti',
        'hutangdetail.coa',
        'hutangdetail.keterangan',
        'hutangdetail.nominal',
        'hutangdetail.dpp',
        'hutangdetail.noinvoiceemkl',
        'hutangdetail.tglinvoiceemkl',
        'hutangdetail.nofakturpajakemkl',
        'hutangdetail.info',
        'hutangdetail.modifiedby',
        'hutangdetail.created_at',
        'hutangdetail.updated_at',
        'hutangdetail.hutang_id',
      )
      .whereNull(`${tempTableName}.id`)
      .where('hutangdetail.hutang_id', id);

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
      .leftJoin(`${tempTableName}`, 'hutangdetail.id', `${tempTableName}.id`)
      .whereNull(`${tempTableName}.id`)
      .where('hutangdetail.hutang_id', id)
      .del();
    if (insertedDataQuery.length > 0) {
      insertedData = await trx('hutangdetail')
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
        postingdari: 'HUTANG HEADER',
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
    const tempUrl = `##temp_url_${Math.random().toString(36).substring(2, 8)}`;

    await trx.schema.createTable(tempUrl, (t) => {
      t.integer('id').nullable();
      t.string('nobukti').nullable();
      t.text('link').nullable();
    });
    const url = 'hutang';
    await trx(tempUrl).insert(
      trx
        .select(
          'u.id',
          'u.nobukti',
          trx.raw(`
                    STRING_AGG(
                      '<a target="_blank" className="link-color" href="/dashboard/${url}' + ${tandatanya} + 'nobukti=' + u.nobukti + '">' +
                      '<HighlightWrapper value="' + u.nobukti + '" />' +
                      '</a>', ','
                    ) AS link
                  `),
        )
        .from(this.tableName + ' as u')
        .groupBy('u.id', 'u.nobukti'),
    );
    try {
      if (!filters?.nobukti) {
        return {
          status: true,
          message: 'Hutang Detail failed to fetch',
          data: [],
        };
      }
      const query = trx
        .from(trx.raw(`${this.tableName} as p`))
        .select(
          'p.id',
          'p.hutang_id',
          'p.nobukti',
          'p.coa',
          'p.keterangan',
          'p.nominal',
          'p.dpp',
          'p.noinvoiceemkl',
          trx.raw(`
          FORMAT(
            (CASE WHEN p.tglinvoiceemkl::text ~ '^[0-9]' THEN p.tglinvoiceemkl::timestamp END),
            'dd-MM-yyyy'
          ) as tglinvoiceemkl
        `),
          'p.nofakturpajakemkl',
          'q.keterangancoa as coa_text',
          'p.info',
          'p.modifiedby',
          trx.raw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'tempUrl.link',
        )
        .innerJoin(trx.raw(`${tempUrl} as tempUrl`), 'p.id', 'tempUrl.id')
        .leftJoin(
          trx.raw('akunpusat as q'),
          'p.coa',
          'q.coa',
        )
        .orderBy('p.created_at', 'desc');

      const excludeSearchKeys = ['hutang_id', 'coa'];

      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (search) {
        const sanitizedValue = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (['created_at', 'updated_at'].includes(field)) {
              qb.orWhereRaw("TO_CHAR(p.??, 'DD-MM-YYYY HH24:MI:SS') like ?", [
                field,
                `%${sanitizedValue}%`,
              ]);
            } else if (field === 'tglinvoiceemkl') {
              qb.orWhereRaw(
                "FORMAT((CASE WHEN p.tglinvoiceemkl::text ~ '^[0-9]' THEN p.tglinvoiceemkl::timestamp END), 'dd-MM-yyyy') like ?",
                [`%${sanitizedValue}%`],
              );
            } else if (field === 'coa_text') {
              qb.orWhere('q.keterangancoa', 'like', `%${sanitizedValue}%`);
            } else {
              qb.orWhere(`p.${field}`, 'like', `%${sanitizedValue}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (!value) continue;
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          switch (key) {
            case 'tglinvoiceemkl':
              query.andWhere('p.tglinvoiceemkl', 'like', sanitizedValue);
              break;

            case 'coa_text':
              query.andWhere('q.keterangancoa', 'like', sanitizedValue);
              break;

            case 'nominal':
            case 'dpp':
              query.andWhere(`p.${key}`, 'like', `%${sanitizedValue}%`);
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
        this.logger.warn('No Data found');
        return {
          status: false,
          message: 'No data found',
          data: [],
        };
      }

      return {
        status: true,
        message: 'Hutang Detail data fetched successfully',
        data: result,
      };
    } catch (error) {
      console.error('Error in findAll Hutang Detail', error);
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} hutangdetail`;
  }

  update(id: string, updateHutangdetailDto: UpdateHutangdetailDto) {
    return `This action updates a #${id} hutangdetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} hutangdetail`;
  }
}
