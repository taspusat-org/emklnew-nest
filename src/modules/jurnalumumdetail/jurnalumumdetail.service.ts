import { Injectable, Logger } from '@nestjs/common';
import { CreateJurnalumumdetailDto } from './dto/create-jurnalumumdetail.dto';
import { UpdateJurnalumumdetailDto } from './dto/update-jurnalumumdetail.dto';
import { withUuidV7, tandatanya, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { filter } from 'rxjs';

@Injectable()
export class JurnalumumdetailService {
  private readonly tableName = 'jurnalumumdetail';
  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  private readonly logger = new Logger(JurnalumumdetailService.name);
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
      await trx(this.tableName).delete().where('jurnalumum_id', id);
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
      jurnalumum_id: item.jurnalumum_id ?? id, // Ensure correct field mapping
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

    // **Update or Insert into 'jurnalumumdetail' with correct idheader**
    const updatedData = await trx('jurnalumumdetail')
      .join(`${tempTableName}`, 'jurnalumumdetail.id', `${tempTableName}.id`)
      .update({
        nobukti: trx.raw(`jurnalumumdetail.nobukti`),
        tglbukti: trx.raw(`jurnalumumdetail.tglbukti`),
        coa: trx.raw(`jurnalumumdetail.coa`),
        keterangan: trx.raw(`${tempTableName}.keterangan`),
        nominal: trx.raw(`${tempTableName}.nominal`),
        info: trx.raw(`${tempTableName}.info`),
        modifiedby: trx.raw(`${tempTableName}.modifiedby`),
        jurnalumum_id: trx.raw(`${tempTableName}.jurnalumum_id`),
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
        'tglbukti',
        'coa',
        'keterangan',
        'nominal',
        'info',
        'modifiedby',
        trx.raw('? as jurnalumum_id', [id]),
        'created_at',
        'updated_at',
      ])
      .where(`${tempTableName}.id`, '0');

    const getDeleted = await trx(this.tableName)
      .leftJoin(
        `${tempTableName}`,
        'jurnalumumdetail.id',
        `${tempTableName}.id`,
      )
      .select(
        'jurnalumumdetail.id',
        'jurnalumumdetail.nobukti',
        'jurnalumumdetail.tglbukti',
        'jurnalumumdetail.coa',
        'jurnalumumdetail.keterangan',
        'jurnalumumdetail.nominal',
        'jurnalumumdetail.info',
        'jurnalumumdetail.modifiedby',
        'jurnalumumdetail.created_at',
        'jurnalumumdetail.updated_at',
        'jurnalumumdetail.jurnalumum_id',
      )
      .whereNull(`${tempTableName}.id`)
      .where('jurnalumumdetail.jurnalumum_id', id);

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
        'jurnalumumdetail.id',
        `${tempTableName}.id`,
      )
      .whereNull(`${tempTableName}.id`)
      .where('jurnalumumdetail.jurnalumum_id', id)
      .del();
    if (insertedDataQuery.length > 0) {
      insertedData = await trx('jurnalumumdetail')
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
        postingdari: 'JURNAL UMUM DETAIL',
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
    const url = 'jurnalumumheader';

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
          message: 'Jurnal umum Detail failed to fetch',
          data: [],
        };
      }
      const query = trx
        .from(trx.raw(`${this.tableName} as p`))
        .select(
          'p.id',
          'p.jurnalumum_id',
          trx.raw("TO_CHAR(p.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'p.nobukti',
          'p.coa',
          'p.keterangan',
          'ap.keterangancoa as coa_nama',

          // Jika nominal < 0 → nominalkredit = ABS(nominal), selain itu 0
          trx.raw(
            'CASE WHEN p.nominal < 0 THEN ABS(p.nominal) ELSE 0 END AS nominalkredit',
          ),

          // Jika nominal > 0 → nominaldebet = nominal, selain itu 0
          trx.raw(
            'CASE WHEN p.nominal > 0 THEN p.nominal ELSE 0 END AS nominaldebet',
          ),

          trx.raw('ABS(p.nominal) AS nominal'),
          'p.info',
          'p.modifiedby',
          trx.raw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'tempUrl.link',
        )
        .innerJoin(trx.raw(`${tempUrl} as tempUrl`), 'p.id', 'tempUrl.id')
        .innerJoin(
          trx.raw('akunpusat as ap'),
          'p.coa',
          'ap.coa',
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
        console.log(search, 'search');
        const sanitized = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            qb.orWhere(`p.${field}`, 'like', `%${sanitized}%`);
          });
        });
      }
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (key === 'pengeluaran_nobukti') {
            continue;
          }
          if (!value) continue;
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          switch (key) {
            case 'coa_nama':
              query.andWhere('ap.keterangancoa', 'like', `%${sanitizedValue}%`);
              break;

            case 'tglbukti':
              query.andWhereRaw("TO_CHAR(p.tglbukti, 'DD-MM-YYYY') LIKE ?", [
                `%${sanitizedValue}%`,
              ]);
              break;

            case 'nominaldebet':
              query.andWhere(
                trx.raw('CASE WHEN p.nominal > 0 THEN p.nominal ELSE 0 END'),
                'like',
                `%${sanitizedValue}%`,
              );
              break;

            case 'nominalkredit':
              query.andWhere(
                trx.raw(
                  'CASE WHEN p.nominal < 0 THEN ABS(p.nominal) ELSE 0 END',
                ),
                'like',
                `%${sanitizedValue}%`,
              );
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
      return {
        data: result,
      };
    } catch (error) {
      console.error('Error in findAll Kas Gantung Detail', error);
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} jurnalumumdetail`;
  }

  update(id: string, updateJurnalumumdetailDto: UpdateJurnalumumdetailDto) {
    return `This action updates a #${id} jurnalumumdetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} jurnalumumdetail`;
  }
}
