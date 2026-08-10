import { Injectable, Logger } from '@nestjs/common';
import { CreatePenerimaandetailDto } from './dto/create-penerimaandetail.dto';
import { UpdatePenerimaandetailDto } from './dto/update-penerimaandetail.dto';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class PenerimaandetailService {
  private readonly tableName = 'penerimaandetail';
  private readonly logger = new Logger(PenerimaandetailService.name);

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
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
      await trx(this.tableName).delete().where('penerimaan_id', id);
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
      penerimaan_id: item.penerimaan_id ?? id, // Ensure correct field mapping
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

    // **Update or Insert into 'penerimaandetail' with correct idheader**
    const updatedData = await trx('penerimaandetail')
      .join(`${tempTableName}`, 'penerimaandetail.id', `${tempTableName}.id`)
      .update({
        nobukti: trx.raw(`penerimaandetail.nobukti`),
        // COA menggunakan data existing dari penerimaandetail
        coa: trx.raw(`penerimaandetail.coa`),
        transaksibiaya_nobukti: trx.raw(
          `${tempTableName}.transaksibiaya_nobukti`,
        ),
        transaksilain_nobukti: trx.raw(
          `${tempTableName}.transaksilain_nobukti`,
        ),
        pengeluaranemklheader_nobukti: trx.raw(
          `${tempTableName}.pengeluaranemklheader_nobukti`,
        ),
        penerimaanemklheader_nobukti: trx.raw(
          `${tempTableName}.penerimaanemklheader_nobukti`,
        ),
        // pengembaliankasgantung_nobukti menggunakan data existing dari penerimaandetail
        pengembaliankasgantung_nobukti: trx.raw(
          `penerimaandetail.pengembaliankasgantung_nobukti`,
        ),
        keterangan: trx.raw(`${tempTableName}.keterangan`),
        nominal: trx.raw(`${tempTableName}.nominal`),
        info: trx.raw(`${tempTableName}.info`),
        modifiedby: trx.raw(`${tempTableName}.modifiedby`),
        penerimaan_id: trx.raw(`${tempTableName}.penerimaan_id`),
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
        'keterangan',
        'nominal',
        'coa',
        'transaksibiaya_nobukti',
        'transaksilain_nobukti',
        'pengeluaranemklheader_nobukti',
        'penerimaanemklheader_nobukti',
        'pengembaliankasgantung_nobukti',
        'info',
        'modifiedby',
        trx.raw('? as penerimaan_id', [id]),
        'created_at',
        'updated_at',
      ])
      .where(`${tempTableName}.id`, '0');

    const getDeleted = await trx(this.tableName)
      .leftJoin(
        `${tempTableName}`,
        'penerimaandetail.id',
        `${tempTableName}.id`,
      )
      .select(
        'penerimaandetail.id',
        'penerimaandetail.nobukti',
        'penerimaandetail.keterangan',
        'penerimaandetail.nominal',
        'penerimaandetail.coa',
        'penerimaandetail.transaksibiaya_nobukti',
        'penerimaandetail.transaksilain_nobukti',
        'penerimaandetail.pengeluaranemklheader_nobukti',
        'penerimaandetail.penerimaanemklheader_nobukti',
        'penerimaandetail.pengembaliankasgantung_nobukti',
        'penerimaandetail.info',
        'penerimaandetail.modifiedby',
        'penerimaandetail.created_at',
        'penerimaandetail.updated_at',
        'penerimaandetail.penerimaan_id',
      )
      .whereNull(`${tempTableName}.id`)
      .where('penerimaandetail.penerimaan_id', id);

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
        'penerimaandetail.id',
        `${tempTableName}.id`,
      )
      .whereNull(`${tempTableName}.id`)
      .where('penerimaandetail.penerimaan_id', id)
      .del();
    if (insertedDataQuery.length > 0) {
      insertedData = await trx('penerimaandetail')
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
  async updateByPengembalianKasGantung(
    details: any,
    id: any = 0,
    trx: any = null,
  ) {
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
      await trx(this.tableName)
        .delete()
        .where('pengembaliankasgantung_nobukti', id);
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
      penerimaan_id: item.penerimaan_id ?? id, // Ensure correct field mapping
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

    // **Update or Insert into 'penerimaandetail' with correct idheader**
    const updatedData = await trx('penerimaandetail')
      .join(`${tempTableName}`, 'penerimaandetail.id', `${tempTableName}.id`)
      .update({
        nobukti: trx.raw(`${tempTableName}.nobukti`),
        coa: trx.raw(`${tempTableName}.coa`),
        transaksibiaya_nobukti: trx.raw(
          `${tempTableName}.transaksibiaya_nobukti`,
        ),
        transaksilain_nobukti: trx.raw(
          `${tempTableName}.transaksilain_nobukti`,
        ),
        pengeluaranemklheader_nobukti: trx.raw(
          `${tempTableName}.pengeluaranemklheader_nobukti`,
        ),
        penerimaanemklheader_nobukti: trx.raw(
          `${tempTableName}.penerimaanemklheader_nobukti`,
        ),
        pengembaliankasgantung_nobukti: trx.raw(
          `${tempTableName}.pengembaliankasgantung_nobukti`,
        ),
        keterangan: trx.raw(`${tempTableName}.keterangan`),
        nominal: trx.raw(`${tempTableName}.nominal`),
        info: trx.raw(`${tempTableName}.info`),
        modifiedby: trx.raw(`${tempTableName}.modifiedby`),
        penerimaan_id: trx.raw(`${tempTableName}.penerimaan_id`),
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
        'keterangan',
        'nominal',
        'coa',
        'transaksibiaya_nobukti',
        'transaksilain_nobukti',
        'pengeluaranemklheader_nobukti',
        'penerimaanemklheader_nobukti',
        'pengembaliankasgantung_nobukti',
        'info',
        'modifiedby',
        trx.raw('? as penerimaan_id', [id]),
        'created_at',
        'updated_at',
      ])
      .where(`${tempTableName}.id`, '0');

    const getDeleted = await trx(this.tableName)
      .leftJoin(
        `${tempTableName}`,
        'penerimaandetail.id',
        `${tempTableName}.id`,
      )
      .select(
        'penerimaandetail.id',
        'penerimaandetail.nobukti',
        'penerimaandetail.keterangan',
        'penerimaandetail.nominal',
        'penerimaandetail.coa',
        'penerimaandetail.transaksibiaya_nobukti',
        'penerimaandetail.transaksilain_nobukti',
        'penerimaandetail.pengeluaranemklheader_nobukti',
        'penerimaandetail.penerimaanemklheader_nobukti',
        'penerimaandetail.pengembaliankasgantung_nobukti',
        'penerimaandetail.info',
        'penerimaandetail.modifiedby',
        'penerimaandetail.created_at',
        'penerimaandetail.updated_at',
        'penerimaandetail.penerimaan_id',
      )
      .whereNull(`${tempTableName}.id`)
      .where('penerimaandetail.penerimaan_id', id);

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
        'penerimaandetail.id',
        `${tempTableName}.id`,
      )
      .whereNull(`${tempTableName}.id`)
      .where('penerimaandetail.penerimaan_id', id)
      .del();
    if (insertedDataQuery.length > 0) {
      insertedData = await trx('penerimaandetail')
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
    if (!filters?.nobukti) {
      return {
        data: [],
      };
    }

    const query = trx(`${this.tableName} as p`)
      .select(
        'p.id',
        'p.penerimaan_id', // Updated field name
        'p.nobukti',
        'p.keterangan',
        'p.coa',
        'p.transaksibiaya_nobukti',
        'p.transaksilain_nobukti',
        'p.pengeluaranemklheader_nobukti',
        'p.penerimaanemklheader_nobukti',
        'p.pengembaliankasgantung_nobukti',
        'p.nominal', // Updated field name
        'p.info',
        'p.modifiedby',
        'ap.keterangancoa as coa_nama',
        trx.raw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
        trx.raw("TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
      )
      .leftJoin('akunpusat as ap', 'p.coa', 'ap.coa');

    if (filters?.nobukti) {
      query.where('p.nobukti', filters?.nobukti);
    }
    if (filters?.pengembaliankasgantung_nobukti) {
      query.where(
        'p.pengembaliankasgantung_nobukti',
        filters?.pengembaliankasgantung_nobukti,
      );
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
          } else if (key === 'coa_nama') {
            query.andWhere(`ap.keterangancoa`, 'like', `%${sanitizedValue}%`);
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
  }

  findOne(id: string) {
    return `This action returns a #${id} penerimaandetail`;
  }

  update(id: string, updatePenerimaandetailDto: UpdatePenerimaandetailDto) {
    return `This action updates a #${id} penerimaandetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} penerimaandetail`;
  }
}
