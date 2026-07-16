import { Injectable, Logger } from '@nestjs/common';
import { CreatePengeluarandetailDto } from './dto/create-pengeluarandetail.dto';
import { UpdatePengeluarandetailDto } from './dto/update-pengeluarandetail.dto';
import { withUuidV7, UtilsService, tandatanya  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class PengeluarandetailService {
  private readonly tableName = 'pengeluarandetail';
  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  private readonly logger = new Logger(PengeluarandetailService.name);
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
      await trx(this.tableName).delete().where('pengeluaran_id', id);
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
      pengeluaran_id: item.pengeluaran_id ?? id, // Ensure correct field mapping
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
    const updatedData = await trx('pengeluarandetail')
      .join(`${tempTableName}`, 'pengeluarandetail.id', `${tempTableName}.id`)
      .update({
        coadebet: trx.raw(`pengeluarandetail.coadebet`),
        keterangan: trx.raw(`${tempTableName}.keterangan`),
        nominal: trx.raw(`${tempTableName}.nominal`),
        dpp: trx.raw(`${tempTableName}.dpp`),
        transaksibiaya_nobukti: trx.raw(
          `${tempTableName}.transaksibiaya_nobukti`,
        ),
        transaksilain_nobukti: trx.raw(
          `${tempTableName}.transaksilain_nobukti`,
        ),
        noinvoiceemkl: trx.raw(`${tempTableName}.noinvoiceemkl`),
        tglinvoiceemkl: trx.raw(`${tempTableName}.tglinvoiceemkl`),
        nofakturpajakemkl: trx.raw(`${tempTableName}.nofakturpajakemkl`),
        perioderefund: trx.raw(`${tempTableName}.perioderefund`),
        pengeluaranemklheader_nobukti: trx.raw(
          `${tempTableName}.pengeluaranemklheader_nobukti`,
        ),
        penerimaanemklheader_nobukti: trx.raw(
          `${tempTableName}.penerimaanemklheader_nobukti`,
        ),
        info: trx.raw(`${tempTableName}.info`),
        modifiedby: trx.raw(`${tempTableName}.modifiedby`),
        pengeluaran_id: trx.raw(`${tempTableName}.pengeluaran_id`),
        created_at: trx.raw(`${tempTableName}.created_at`),
        updated_at: trx.raw(`${tempTableName}.updated_at`),
        kasgantung_nobukti: trx.raw(`${tempTableName}.kasgantung_nobukti`),
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
        'coadebet',
        'nobukti',
        'keterangan',
        'nominal',
        'dpp',
        'transaksibiaya_nobukti',
        'transaksilain_nobukti',
        'noinvoiceemkl',
        'tglinvoiceemkl',
        'nofakturpajakemkl',
        'perioderefund',
        'pengeluaranemklheader_nobukti',
        'penerimaanemklheader_nobukti',
        'info',
        'modifiedby',
        trx.raw('? as pengeluaran_id', [id]),
        'created_at',
        'updated_at',
        'kasgantung_nobukti',
      ])
      .where(`${tempTableName}.id`, '0');

    const getDeleted = await trx(this.tableName)
      .leftJoin(
        `${tempTableName}`,
        'pengeluarandetail.id',
        `${tempTableName}.id`,
      )
      .select(
        'pengeluarandetail.id',
        'pengeluarandetail.coadebet',
        'pengeluarandetail.nobukti',
        'pengeluarandetail.keterangan',
        'pengeluarandetail.nominal',
        'pengeluarandetail.dpp',
        'pengeluarandetail.transaksibiaya_nobukti',
        'pengeluarandetail.transaksilain_nobukti',
        'pengeluarandetail.noinvoiceemkl',
        'pengeluarandetail.tglinvoiceemkl',
        'pengeluarandetail.nofakturpajakemkl',
        'pengeluarandetail.perioderefund',
        'pengeluarandetail.pengeluaranemklheader_nobukti',
        'pengeluarandetail.penerimaanemklheader_nobukti',
        'pengeluarandetail.info',
        'pengeluarandetail.modifiedby',
        'pengeluarandetail.created_at',
        'pengeluarandetail.updated_at',
        'pengeluarandetail.kasgantung_nobukti',
        'pengeluarandetail.pengeluaran_id',
      )
      .whereNull(`${tempTableName}.id`)
      .where('pengeluarandetail.pengeluaran_id', id);

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
        'pengeluarandetail.id',
        `${tempTableName}.id`,
      )
      .whereNull(`${tempTableName}.id`)
      .where('pengeluarandetail.pengeluaran_id', id)
      .del();
    if (insertedDataQuery.length > 0) {
      insertedData = await trx('pengeluarandetail')
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
        postingdari: 'PENGELUARAN HEADER',
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
      // id pengeluarandetail = varchar(200) UUID. Pakai integer di sini bikin
      // "Conversion failed converting varchar '02-...' to int" saat insert ->
      // GET /pengeluarandetail 500.
      t.string('id', 200).nullable();
      t.string('nobukti').nullable();
      t.text('link').nullable();
    });
    const url = 'pengeluaran';
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
          'p.pengeluaran_id',
          'p.coadebet',
          'p.nobukti',
          'p.keterangan',
          'p.nominal',
          'p.dpp',
          'p.transaksibiaya_nobukti',
          'p.transaksilain_nobukti',
          'p.noinvoiceemkl',
          trx.raw("TO_CHAR(p.tglinvoiceemkl, 'DD-MM-YYYY') as tglinvoiceemkl"),
          'p.nofakturpajakemkl',
          'p.perioderefund',
          'p.pengeluaranemklheader_nobukti',
          'p.penerimaanemklheader_nobukti',
          'q.keterangancoa as coadebet_text',
          'p.info',
          'p.modifiedby',
          trx.raw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'tempUrl.link',
        )
        .innerJoin(trx.raw(`${tempUrl} as tempUrl`), 'p.id', 'tempUrl.id')
        .leftJoin(
          trx.raw('akunpusat as q'),
          'p.coadebet',
          'q.coa',
        )
        .orderBy('p.created_at', 'desc');
      if (filters?.nobukti) {
        query.where('p.nobukti', filters?.nobukti);
      }
      const excludeSearchKeys = ['pengeluaran_id', 'coadebet'];

      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (search) {
        const sanitizedValue = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (
              ['created_at', 'updated_at', 'tglinvoiceemkl'].includes(field)
            ) {
              qb.orWhereRaw("TO_CHAR(p.??, 'DD-MM-YYYY HH24:MI:SS') like ?", [
                field,
                `%${sanitizedValue}%`,
              ]);
            } else if (field === 'coadebet_text') {
              qb.orWhere('q.keterangancoa', 'like', `%${sanitizedValue}%`);
            } else if (field === 'nominal' || field === 'dpp') {
              qb.orWhere(`p.${field}`, 'like', `%${Number(sanitizedValue)}%`);
            } else {
              qb.orWhere(`p.${field}`, 'like', `%${sanitizedValue}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (key === 'pengeluaran_nobukti') {
            continue;
          }
          const sanitizedValue = String(value).replace(/\[/g, '[[]');
          if (value) {
            switch (key) {
              case 'coadebet_text':
                query.andWhere(
                  'q.keterangancoa',
                  'like',
                  `%${sanitizedValue}%`,
                );
                break;
              case 'tglinvoiceemkl_dari':
                query.andWhere('p.tglinvoiceemkl', '>=', sanitizedValue);
                break;
              case 'tglinvoiceemkl_sampai':
                query.andWhere('p.tglinvoiceemkl', '<=', sanitizedValue);
                break;
              default:
                query.andWhere(`p.${key}`, 'like', `%${sanitizedValue}%`);
            }
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
        message: 'Pengeluaran Detail data fetched successfully',
        data: result,
      };
    } catch (error) {
      console.error('Error in findAll Pengeluaran Detail', error);
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} pengeluarandetail`;
  }

  update(id: string, updatePengeluarandetailDto: UpdatePengeluarandetailDto) {
    return `This action updates a #${id} pengeluarandetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} pengeluarandetail`;
  }
}
