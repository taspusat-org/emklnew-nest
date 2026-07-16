import { Injectable, Logger } from '@nestjs/common';
import { CreateScheduleDetailDto } from './dto/create-schedule-detail.dto';
import { UpdateScheduleDetailDto } from './dto/update-schedule-detail.dto';
import {
  withUuidV7,
  formatDateTimeToSQL,
  formatDateToSQL,
  UtilsService,
 } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { ScheduleKapalService } from '../schedule-kapal/schedule-kapal.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';

@Injectable()
export class ScheduleDetailService {
  private readonly tableName = 'scheduledetail';
  private readonly logger = new Logger(ScheduleDetailService.name);

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly scheduleKapalService: ScheduleKapalService,
  ) {}

  async create(details: any, id: any = 0, trx: any = null) {
    let insertedData = null;
    let data: any = null;
    const tempTableName = `##temp_${Math.random().toString(36).substring(2, 15)}`;
    const time = this.utilsService.getTime();
    const logData: any[] = [];
    const mainDataToInsert: any[] = [];
    let schedulekapal_id;
    //

    const result = await trx(this.tableName).columnInfo(); // Get the column info and create temporary table
    const tableTemp = await this.utilsService.createTempTable(
      this.tableName,
      trx,
      tempTableName,
    );

    if (details.length === 0) {
      await trx(this.tableName).delete().where('schedule_id', id);
      return;
    }

    const fixDetail = details.map(
      ({ pelayaran_nama, kapal_nama, tujuankapal_nama, ...details }) => ({
        ...details,
      }),
    );

    for (data of fixDetail) {
      let isDataChanged = false;

      // Tetap format tanggal DD-MM-YYYY. Uppercase hanya kolom teks manusiawi:
      // pelayaran_id/kapal_id/tujuankapal_id/schedule_id (FK) dan id adalah
      // UUID bertipe text (case-sensitive) yang rusak bila di-uppercase
      // (mis. bikin lookup schedulekapal meleset).
      const upperFields = ['keterangan', 'voyberangkat', 'voytiba'];
      Object.keys(data).forEach((key) => {
        if (typeof data[key] === 'string') {
          const value = data[key];
          const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

          if (dateRegex.test(value)) {
            data[key] = formatDateToSQL(value);
          } else if (upperFields.includes(key)) {
            data[key] = value.toUpperCase();
          }
        }
      });

      if (
        data.kapal_id != null &&
        data.pelayaran_id != null &&
        data.tglberangkat != null
      ) {
        const dataScheduleKapal = await this.scheduleKapalService.findAll(
          {
            filters: {
              kapal_id: data.kapal_id,
              pelayaran_id: data.pelayaran_id,
              tglberangkat: data.tglberangkat,
              voyberangkat: data.voyberangkat,
              tujuankapal_id: data.tujuankapal_id,
            },
            pagination: { page: 1, limit: 0 }, // default pagination
          },
          trx,
        );

        if (dataScheduleKapal.data.length === 0) {
          const dataInsertShceduleKapal = {
            kapal_id: data.kapal_id,
            pelayaran_id: data.pelayaran_id,
            tglberangkat: data.tglberangkat,
            voyberangkat: data.voyberangkat,
            tujuankapal_id: data.tujuankapal_id,
            modifiedby: data.modifiedby,
          };
          const insertScheduleKapal = await this.scheduleKapalService.create(
            dataInsertShceduleKapal,
            trx,
          );
          schedulekapal_id = insertScheduleKapal.newData.id;
          //
        } else {
          schedulekapal_id = dataScheduleKapal.data[0].id;
        }
      }

      if (data.id) {
        // Check if the data has an id (existing record)
        const existingData = await trx(this.tableName)
          .where('id', data.id)
          .first();
        if (existingData) {
          const createdAt = {
            created_at: existingData.created_at,
            updated_at: existingData.updated_at,
          };
          Object.assign(data, createdAt);
          data.closing = formatDateTimeToSQL(String(data?.closing));
          data.schedulekapal_id = schedulekapal_id;
          // data.tgltiba = formatDateToSQL(String(data?.tgltiba))
          // data.etb = formatDateToSQL(String(data?.etb))
          // data.eta = formatDateToSQL(String(data?.eta))
          // data.etd = formatDateToSQL(String(data?.etd))
          // data.closing = formatDateToSQL(String(data?.closing))
          // data.etatujuan = formatDateToSQL(String(data?.etatujuan))
          // data.etdtujuan = formatDateToSQL(String(data?.etdtujuan))

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
        data.closing = formatDateTimeToSQL(String(data?.closing));
        data.schedulekapal_id = schedulekapal_id;
        // data.tgltiba = formatDateToSQL(String(data?.tgltiba))
        // data.etb = formatDateToSQL(String(data?.etb))
        // data.eta = formatDateToSQL(String(data?.eta))
        // data.etd = formatDateToSQL(String(data?.etd))
        // data.closing = formatDateToSQL(String(data?.closing))
        // data.etatujuan = formatDateToSQL(String(data?.etatujuan))
        // data.etdtujuan = formatDateToSQL(String(data?.etdtujuan))
      }
      //

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
    //

    await trx.raw(tableTemp); // Create temporary table to insert

    // Ensure each item has an idheader
    const processedData = mainDataToInsert.map((item: any) => ({
      ...item,
      schedule_id: item.schedule_id ?? id, // Ensure correct field mapping
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
    //

    // Insert into temp table
    await trx(tempTableName).insert(openJson);

    const updatedData = await trx('scheduledetail')
      .join(`${tempTableName}`, 'scheduledetail.id', `${tempTableName}.id`)
      .update({
        nobukti: trx.raw(`${tempTableName}.nobukti`),
        pelayaran_id: trx.raw(`${tempTableName}.pelayaran_id`),
        kapal_id: trx.raw(`${tempTableName}.kapal_id`),
        tujuankapal_id: trx.raw(`${tempTableName}.tujuankapal_id`),
        schedulekapal_id: trx.raw(`${tempTableName}.schedulekapal_id`),
        tglberangkat: trx.raw(`${tempTableName}.tglberangkat`),
        tgltiba: trx.raw(`${tempTableName}.tgltiba`),
        etb: trx.raw(`${tempTableName}.etb`),
        eta: trx.raw(`${tempTableName}.eta`),
        etd: trx.raw(`${tempTableName}.etd`),
        voyberangkat: trx.raw(`${tempTableName}.voyberangkat`),
        voytiba: trx.raw(`${tempTableName}.voytiba`),
        closing: trx.raw(`${tempTableName}.closing`),
        etatujuan: trx.raw(`${tempTableName}.etatujuan`),
        etdtujuan: trx.raw(`${tempTableName}.etdtujuan`),
        keterangan: trx.raw(`${tempTableName}.keterangan`),
        modifiedby: trx.raw(`${tempTableName}.modifiedby`),
        created_at: trx.raw(`${tempTableName}.created_at`),
        updated_at: trx.raw(`${tempTableName}.updated_at`),
      })
      .returning('*')
      .then((result: any) => result[0])
      .catch((error: any) => {
        console.error(
          'Error inserting data schedule detail in servoce',
          error,
          error.message,
        );
        throw error;
      });

    // Handle insertion if no update occurs
    const insertedDataQuery = await trx(tempTableName)
      .select([
        'nobukti',
        'pelayaran_id',
        'kapal_id',
        'tujuankapal_id',
        'schedulekapal_id',
        'tglberangkat',
        'tgltiba',
        'etb',
        'eta',
        'etd',
        'voyberangkat',
        'voytiba',
        'closing',
        'etatujuan',
        'etdtujuan',
        'keterangan',
        'modifiedby',
        trx.raw('? as schedule_id', [id]),
        'created_at',
        'updated_at',
      ])
      .where(`${tempTableName}.id`, '0');
    //

    const getDeleted = await trx(this.tableName)
      .leftJoin(`${tempTableName}`, 'scheduledetail.id', `${tempTableName}.id`)
      .select(
        'scheduledetail.id',
        'scheduledetail.nobukti',
        'scheduledetail.pelayaran_id',
        'scheduledetail.kapal_id',
        'scheduledetail.tujuankapal_id',
        'scheduledetail.schedulekapal_id',
        'scheduledetail.tglberangkat',
        'scheduledetail.tgltiba',
        'scheduledetail.etb',
        'scheduledetail.eta',
        'scheduledetail.etd',
        'scheduledetail.voyberangkat',
        'scheduledetail.voytiba',
        'scheduledetail.closing',
        'scheduledetail.etatujuan',
        'scheduledetail.etdtujuan',
        'scheduledetail.keterangan',
        'scheduledetail.modifiedby',
        'scheduledetail.created_at',
        'scheduledetail.updated_at',
        'scheduledetail.schedule_id',
      )
      .whereNull(`${tempTableName}.id`)
      .where('scheduledetail.schedule_id', id);

    let pushToLog: any[] = [];
    //

    if (getDeleted.length > 0) {
      pushToLog = Object.assign(getDeleted, { aksi: 'DELETE' });
    }

    const pushToLogWithAction = pushToLog.map((entry) => ({
      ...entry,
      aksi: 'DELETE',
    }));

    const finalData = logData.concat(pushToLogWithAction);

    const deletedData = await trx(this.tableName)
      .leftJoin(`${tempTableName}`, 'scheduledetail.id', `${tempTableName}.id`)
      .whereNull(`${tempTableName}.id`)
      .where('scheduledetail.schedule_id', id)
      .del();

    if (insertedDataQuery.length > 0) {
      insertedData = await trx('scheduledetail')
        .insert(await withUuidV7(trx, insertedDataQuery))
        .returning('*')
        .then((result: any) => result[0])
        .catch((error: any) => {
          console.error(
            'Error inserting data to schedule detail in service:',
            error,
          );
          throw error;
        });
    }

    await this.logTrailService.create(
      {
        namatabel: this.tableName,
        postingdari: 'ADD SCHEDULE DETAIL',
        idtrans: id,
        nobuktitrans: id,
        aksi: 'EDIT',
        datajson: JSON.stringify(finalData),
        modifiedby: details[0].modifiedby,
      },
      trx,
    );

    return updatedData || insertedData;
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

      const query = trx(`${this.tableName} as p`)
        .select(
          'p.id',
          'p.schedule_id',
          'p.nobukti',
          'p.pelayaran_id',
          'p.kapal_id',
          'p.tujuankapal_id',
          'p.schedulekapal_id',
          trx.raw("TO_CHAR(p.tglberangkat, 'DD-MM-YYYY') as tglberangkat"),
          trx.raw("TO_CHAR(p.tgltiba, 'DD-MM-YYYY') as tgltiba"),
          trx.raw("TO_CHAR(p.etb, 'DD-MM-YYYY') as etb"),
          trx.raw("TO_CHAR(p.eta, 'DD-MM-YYYY') as eta"),
          trx.raw("TO_CHAR(p.etd, 'DD-MM-YYYY') as etd"),
          'p.voyberangkat',
          'p.voytiba',
          trx.raw("TO_CHAR(p.closing, 'DD-MM-YYYY HH24:MI:SS') as closing"),
          trx.raw(
            "TO_CHAR(p.closing, 'DD-MM-YYYY HH12:MI AM') as closingForDateTime",
          ),
          trx.raw("TO_CHAR(p.etatujuan, 'DD-MM-YYYY') as etatujuan"),
          trx.raw("TO_CHAR(p.etdtujuan, 'DD-MM-YYYY') as etdtujuan"),
          'p.keterangan',
          'p.modifiedby',
          trx.raw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'pel.nama as pelayaran_nama',
          'kapal.nama as kapal_nama',
          'q.nama as tujuankapal_nama',
        )
        .leftJoin('pelayaran as pel', 'p.pelayaran_id', 'pel.id')
        .leftJoin('kapal', 'p.kapal_id', 'kapal.id')
        .leftJoin('tujuankapal as q', 'p.tujuankapal_id', 'q.id')
        .where('schedule_id', id);

      const excludeSearchKeys = ['tglDari', 'tglSampai'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();
        query.where((qb) => {
          searchFields.forEach((field) => {
            if (field === 'pelayaran') {
              qb.orWhere(`pel.nama`, 'like', `%${sanitized}%`);
            } else if (field === 'kapal') {
              qb.orWhere(`kapal.nama`, 'like', `%${sanitized}%`);
            } else if (field === 'tujuankapal') {
              qb.orWhere(`q.nama`, 'like', `%${sanitized}%`);
            } else {
              qb.orWhere(`p.${field}`, 'like', `%${sanitized}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          if (key === 'tglDari' || key === 'tglSampai') {
            continue;
          }

          if (value) {
            if (key === 'pelayaran') {
              query.andWhere(`pel.nama`, 'like', `%${sanitizedValue}%`);
            } else if (key === 'kapal') {
              query.andWhere('kapal.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'tujuankapal') {
              query.andWhere('q.nama', 'like', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`p.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'pelayaran') {
          query.orderBy(`pel.nama`, sort.sortDirection);
        } else if (sort?.sortBy === 'kapal') {
          query.orderBy(`kapal.nama`, sort.sortDirection);
        } else if (sort?.sortBy === 'tujuankapal') {
          query.orderBy(`q.nama`, sort.sortDirection);
        } else {
          query.orderBy(sort.sortBy, sort.sortDirection);
        }
      }

      const result = await query;

      if (!result.length) {
        this.logger.warn(
          `No data schedule detail found for id schedule header: ${id}`,
        );
        return {
          status: false,
          message: 'No Data Schedule Detail Found',
          data: [],
        };
      }

      return {
        status: true,
        message: 'Schedule Detail data fetched successfully',
        data: result,
      };
    } catch (error) {
      console.error('Error to findAll Schedule detail in service', error);
      throw new Error(error);
    }
  }

  async getScheduleDetailForExport(id: any) {
    try {
      const result = await dbMssql(`${this.tableName} as p`)
        .select(
          'p.id',
          'p.schedule_id',
          'p.nobukti',
          'p.pelayaran_id',
          'p.kapal_id',
          'p.tujuankapal_id',
          'p.schedulekapal_id',
          dbMssql.raw("TO_CHAR(p.tglberangkat, 'DD-MM-YYYY') as tglberangkat"),
          dbMssql.raw("TO_CHAR(p.tgltiba, 'DD-MM-YYYY') as tgltiba"),
          dbMssql.raw("TO_CHAR(p.etb, 'DD-MM-YYYY') as etb"),
          dbMssql.raw("TO_CHAR(p.eta, 'DD-MM-YYYY') as eta"),
          dbMssql.raw("TO_CHAR(p.etd, 'DD-MM-YYYY') as etd"),
          'p.voyberangkat',
          'p.voytiba',
          dbMssql.raw("TO_CHAR(p.closing, 'DD-MM-YYYY HH24:MI:SS') as closing"),
          dbMssql.raw(
            "TO_CHAR(p.closing, 'DD-MM-YYYY HH12:MI AM') as closingForDateTime",
          ),
          dbMssql.raw("TO_CHAR(p.etatujuan, 'DD-MM-YYYY') as etatujuan"),
          dbMssql.raw("TO_CHAR(p.etdtujuan, 'DD-MM-YYYY') as etdtujuan"),
          'p.keterangan',
          'p.modifiedby',
          dbMssql.raw(
            "TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          dbMssql.raw(
            "TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
          'pel.nama as pelayaran_nama',
          'kapal.nama as kapal_nama',
          'q.nama as tujuankapal_nama',
        )
        .leftJoin('pelayaran as pel', 'p.pelayaran_id', 'pel.id')
        .leftJoin('kapal', 'p.kapal_id', 'kapal.id')
        .leftJoin('tujuankapal as q', 'p.tujuankapal_id', 'q.id')
        .where('schedule_id', id)
        .orderBy('p.id', 'asc');

      if (!result.length) {
        this.logger.warn(
          `No data schedule detail found for id schedule header: ${id}`,
        );
        return {
          status: false,
          message: 'No Data Schedule Detail Found',
          data: [],
        };
      }

      return {
        status: true,
        message: 'Schedule Detail data fetched successfully',
        data: result,
      };
    } catch (error) {
      console.error(
        'Error to get Schedule detail for export in service',
        error,
      );
      throw new Error(error);
    }
  }

  update(id: string, updateScheduleDetailDto: UpdateScheduleDetailDto) {
    return `This action updates a #${id} scheduleDetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} scheduleDetail`;
  }
}
