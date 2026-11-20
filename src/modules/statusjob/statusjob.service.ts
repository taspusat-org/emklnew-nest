import {
  Inject,
  HttpStatus,
  Injectable,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Column, Workbook } from 'exceljs';
import { RedisService } from 'src/common/redis/redis.service';
import { UpdateStatusjobDto } from './dto/update-statusjob.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { withUuidV7, UtilsService, formatDateToSQL  } from 'src/utils/utils.service';
import { LocksService } from '../locks/locks.service';

@Injectable()
export class StatusjobService {
  private readonly tableName = 'statusjob';

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly logTrailService: LogtrailService,
  ) {}
  async create(data: any, trx: any) {
    try {
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        method,
        jenisorder_nama,
        statusjob_nama,
        details,
        ...insertData
      } = data;

      let result;
      const grp = data?.grp ? data.grp : 'DATA STATUS JOB';
      const getDataRequest = await trx('parameter')
        .select('id', 'grp', 'subgrp', 'text')
        .where('grp', grp)
        .where('text', statusjob_nama)
        .first();
      console.log('create', data, grp, 'getDataRequest', getDataRequest);

      if (details && details.length > 0) {
        for (const [index, item] of details.entries()) {
          const payload = {
            statusjob: getDataRequest.id,
            job: item.job,
            tglstatus: data.tglstatus,
            keterangan: item.keterangan,
            jenisorder_id: data.jenisorder_id,
            modifiedby: data.modifiedby,
            updated_at: this.utilsService.getTime(),
            created_at: this.utilsService.getTime(),
          };

          Object.keys(payload).forEach((key) => {
            if (typeof payload[key] === 'string') {
              const value = payload[key];
              const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

              if (dateRegex.test(value)) {
                payload[key] = formatDateToSQL(value);
              } else {
                payload[key] = payload[key].toUpperCase();
              }
            }
          });

          result = await trx(this.tableName).insert(await withUuidV7(trx, payload)).returning('*');

          await this.logTrailService.create(
            {
              namatabel: this.tableName,
              postingdari: `ADD STATUS JOB`,
              idtrans: result[0].id,
              nobuktitrans: result[0].id,
              aksi: 'ADD',
              datajson: JSON.stringify(result[0]),
              modifiedby: result[0]?.modifiedby,
            },
            trx,
          );
        }
      } else {
        const payload = {
          statusjob: getDataRequest.id,
          job: data.job,
          tglstatus: data.tglstatus,
          keterangan: data.keterangan,
          jenisorder_id: data.jenisorder_id,
          modifiedby: data.modifiedby,
          updated_at: this.utilsService.getTime(),
          created_at: this.utilsService.getTime(),
        };

        result = await trx(this.tableName).insert(await withUuidV7(trx, payload)).returning('*');

        await this.logTrailService.create(
          {
            namatabel: this.tableName,
            postingdari: `ADD STATUS JOB`,
            idtrans: result[0].id,
            nobuktitrans: result[0].id,
            aksi: 'ADD',
            datajson: JSON.stringify(result[0]),
            modifiedby: result[0]?.modifiedby,
          },
          trx,
        );
      }

      const { data: allData, pagination } = await this.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false,
        },
        trx,
      );

      let dataIndex = allData.findIndex((item) => item.id === result[0].id);
      if (dataIndex === -1) {
        dataIndex = 0;
      }
      const pageNumber = pagination?.currentPage;

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(allData),
      );

      return {
        status: HttpStatus.OK,
        message: 'Proses create status job berhasil dijalankan.',
        pageNumber,
        dataIndex,
      };
    } catch (error) {
      console.error('Error processing status job :', error.message);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to process status job ');
    }
  }

  async findAll(
    { search, filters, pagination, sort, isLookUp }: FindAllParams,
    trx: any,
  ) {
    try {
      let { page, limit } = pagination ?? {};
      page = page ?? 1;
      limit = limit ?? 0;

      console.log('filters di findAll', filters);
      // const tempStatusJob = `##temp_hasil${Math.random().toString(36).substring(2, 15)}`;
      // const tempGroupBy = `##temp_hasil${Math.random().toString(36).substring(2, 15)}`;
      // await trx.schema.createTable(tempStatusJob, (t) => {
      //   t.bigInteger('id').nullable();
      //   t.date('tglstatus').nullable();
      //   t.bigInteger('jenisorder_id').nullable();
      //   t.bigInteger('statusjob').nullable();
      // });

      // await trx.schema.createTable(tempGroupBy, (t) => {
      //   t.date('tglstatus').nullable();
      // });

      // await trx(tempStatusJob).insert(
      //   trx
      //     .select(
      //       'a.id',
      //       'a.tglstatus',
      //       'a.jenisorder_id',
      //       'a.statusjob'
      //     )
      //     .from(`${this.tableName} as a`)
      // );
      // console.log('await trx(tempStatusJob).select(*)', await trx(tempStatusJob).select('*'));

      // await trx(tempGroupBy).insert(
      //   trx
      //   .select(
      //     "u.tglstatus as tglstatus"
      //   )
      //   .from(`${this.tableName} as u`)
      //   .groupBy('u.tglstatus')
      // );
      // console.log('await trx(tempGroupBy).select(*)', await trx(tempGroupBy).select('*'));

      // const query = trx(`${tempGroupBy} as u`)
      //   .select(
      //     'temp.id',
      //     trx.raw("TO_CHAR(u.tglstatus, 'DD-MM-YYYY') as tglstatus")
      //   )
      //   .innerJoin(`${tempStatusJob} as temp`, 'u.tglstatus', 'temp.tglstatus');

      const query = trx(`${this.tableName} as u`)
        .select([trx.raw("TO_CHAR(u.tglstatus, 'DD-MM-YYYY') as tglstatus")])
        .groupBy('u.tglstatus');

      if (filters?.jenisOrderan) {
        query.where('u.jenisorder_id', filters?.jenisOrderan);
      }

      if (filters?.jenisStatusJob) {
        query.where('u.statusjob', filters?.jenisStatusJob);
      }

      if (filters?.tglDari && filters?.tglSampai) {
        const tglDariFormatted = formatDateToSQL(String(filters?.tglDari));
        const tglSampaiFormatted = formatDateToSQL(String(filters?.tglSampai));

        query.whereBetween('u.tglstatus', [
          tglDariFormatted,
          tglSampaiFormatted,
        ]);
      }

      if (search) {
        const sanitizedValue = String(search);
        query.where((builder) => {
          builder.orWhereRaw("TO_CHAR(u.tglstatus, 'DD-MM-YYYY') ILIKE ?", [
            `%${sanitizedValue}%`,
          ]);
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value);

          if (
            key === 'tglDari' ||
            key === 'tglSampai' ||
            key === 'jenisOrderan' ||
            key === 'jenisStatusJob'
          ) {
            continue; // Lewati filter jika key adalah 'tglDari' atau 'tglSampai'
          }

          if (value) {
            if (key === 'tglstatus') {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY') ILIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else {
              query.andWhere(`u.${key}`, 'ilike', `%${sanitizedValue}%`);
            }
          }
        }
      }

      // switch (true) {
      //   case !!search:
      //     const sanitizedValue = String(search).trim();
      //     query.where((builder) => {
      //       builder
      //         .orWhereRaw("TO_CHAR(u.tglstatus, 'DD-MM-YYYY') ILIKE ?", [
      //           `%${sanitizedValue}%`,
      //         ])
      //     });

      //     // const sanitized = String(search).trim();
      //     // query.where((qb) => {
      //     //   const searchFields = Object.keys(filters || {}).filter(
      //     //     (k) => !['tglDari', 'tglSampai'].includes(k) && filters![k],
      //     //   );
      //     //   console.log('searchFields', searchFields);

      //     //   searchFields.forEach((field) => {
      //     //     qb.orWhere(`u.${field}`, 'ilike', `%${sanitized}%`);
      //     //   });
      //     // });

      //     break;
      //   case !!filters:
      //     if (filters?.jenisOrderan) {
      //       query.where('u.jenisorder_id', filters?.jenisOrderan)
      //     }

      //     for (const [key, value] of Object.entries(filters)) {
      //       const sanitizedValue = String(value);
      //       if (key === 'tglDari' || key === 'tglSampai' || key === 'jenisOrderan') continue;

      //       if (value) {
      //         if (
      //           key === 'tglstatus'
      //         ) {
      //           query.andWhereRaw(
      //             "TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?",
      //             [key, `%${sanitizedValue}%`],
      //           );
      //         } else {
      //           query.andWhere(`u.${key}`, 'ilike', `%${sanitizedValue}%`);
      //         }
      //       }
      //     }
      //     break;
      // }

      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }

      const result = await trx(this.tableName).count('id as total').first();
      const total = result?.total as number;
      const totalPages = Math.ceil(total / limit);
      const data = await query;
      console.log('data findAll', data);
      const responseType = Number(total) > 500 ? 'json' : 'local';

      return {
        data: data,
        type: responseType,
        total,
        pagination: {
          currentPage: Number(page),
          totalPages: totalPages,
          totalItems: total,
          itemsPerPage: limit > 0 ? limit : total,
        },
      };
    } catch (error) {
      console.error('Error to findAll Status Job', error);
      throw new Error(error);
    }
  }

  async findOne(
    trx: any,
    { search, filters, pagination, sort, isLookUp }: FindAllParams,
    tglstatus: any,
  ) {
    try {
      const { jenisOrderan, jenisStatusJob, ...filtersWithoutTanggal } =
        filters ?? {};
      console.log(
        'filters',
        filtersWithoutTanggal,
        'tglstatus',
        tglstatus.tglstatus,
        'jenisOrderan',
        jenisOrderan,
        'jenisStatusJob',
        jenisStatusJob,
      );

      const cleanTglstatus = tglstatus.tglstatus.replace(/"/g, '');
      const formatTglStatus = formatDateToSQL(cleanTglstatus);
      let joinTable;
      let { page, limit } = pagination ?? {};
      page = page ?? 1;
      limit = 0;

      const getJenisOrderanMuatan = await trx
        .from(trx.raw(`jenisorder`))
        .select('id')
        .where('nama', 'MUATAN')
        .first();
      const getJenisOrderanBongkaran = await trx
        .from(trx.raw(`jenisorder`))
        .select('id')
        .where('nama', 'BONGKARAN')
        .first();
      const getJenisOrderanImport = await trx
        .from(trx.raw(`jenisorder`))
        .select('id')
        .where('nama', 'IMPORT')
        .first();
      const getJenisOrderanExport = await trx
        .from(trx.raw(`jenisorder`))
        .select('id')
        .where('nama', 'EKSPORT')
        .first();

      switch (jenisOrderan) {
        case getJenisOrderanMuatan?.id:
          joinTable = 'orderanmuatan';
          break;
        // case 'IMPORT':
        //   service = this.hitungmodalimportService;
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          joinTable = 'orderanmuatan';
          break;
      }

      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id',
          'u.statusjob',
          trx.raw("TO_CHAR(u.tglstatus, 'DD-MM-YYYY') as tglstatus"),
          'u.job',
          'u.jenisorder_id as jenisorderan_id',
          'u.keterangan',
          'u.modifiedby',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'c.nobukti as job_nama',
          trx.raw("TO_CHAR(d.tglbukti, 'DD-MM-YYYY') as tglorder"),
          'c.nocontainer as nocontainer',
          'c.noseal as noseal',
          'c.shipper_id as shipper_id',
          'e.nama as shipper_nama',
          'c.nosp as nosp',
          'c.lokasistuffing as lokasistuffing',
          'f.keterangan as lokasistuffing_nama',
          'b.nama as jenisorder_nama',
          'parameter.text as statusjob_nama',
        ])
        .leftJoin('jenisorder as b', 'u.jenisorder_id', 'b.id')
        .leftJoin(`${joinTable} as c`, 'u.job', 'c.id')
        .leftJoin('orderanheader as d', 'c.orderan_id', 'd.id')
        .leftJoin('shipper as e', 'c.shipper_id', 'e.id')
        .leftJoin('hargatrucking as f', 'c.lokasistuffing', 'f.id')
        .leftJoin('parameter', 'u.statusjob', 'parameter.id')
        .where('u.tglstatus', formatTglStatus);

      if (
        filters?.jenisOrderan &&
        filters?.jenisOrderan !== 'null' &&
        filters?.jenisOrderan !== null
      ) {
        query.where('u.jenisorder_id', Number(filters?.jenisOrderan));
      }

      if (
        filters?.jenisStatusJob &&
        filters?.jenisStatusJob !== 'null' &&
        filters?.jenisStatusJob !== null
      ) {
        query.where('u.statusjob', Number(filters?.jenisStatusJob));
      }

      if (search) {
        const sanitizedValue = String(search);
        query.where((builder) => {
          builder
            .orWhere('c.nobukti', 'ilike', `%${sanitizedValue}%`)
            .orWhereRaw("TO_CHAR(d.tglbukti, 'DD-MM-YYYY') ILIKE ?", [
              `%${sanitizedValue}%`,
            ])
            .orWhere('c.nocontainer', 'ilike', `%${sanitizedValue}%`)
            .orWhere('c.noseal', 'ilike', `%${sanitizedValue}%`)
            .orWhere('e.nama', 'ilike', `%${sanitizedValue}%`)
            .orWhere('c.nosp', 'ilike', `%${sanitizedValue}%`)
            .orWhere('f.keterangan', 'ilike', `%${sanitizedValue}%`)
            .orWhere('u.keterangan', 'ilike', `%${sanitizedValue}%`);
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value);

          if (key === 'jenisOrderan' || key === 'jenisStatusJob') {
            continue;
          }

          if (value) {
            if (key === 'tglorder') {
              query.andWhereRaw("TO_CHAR(d.tglbukti, 'DD-MM-YYYY') ILIKE ?", [
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'job_text') {
              query.andWhere('c.nobukti', 'ilike', `%${sanitizedValue}%`);
            } else if (key === 'nocontainer') {
              query.andWhere('c.nocontainer', 'ilike', `%${sanitizedValue}%`);
            } else if (key === 'noseal') {
              query.andWhere('c.noseal', 'ilike', `%${sanitizedValue}%`);
            } else if (key === 'shipper_text') {
              query.andWhere('e.nama', 'ilike', `%${sanitizedValue}%`);
            } else if (key === 'nosp') {
              query.andWhere('c.nosp', 'ilike', `%${sanitizedValue}%`);
            } else if (key === 'lokasistuffing_text') {
              query.andWhere('f.keterangan', 'ilike', `%${sanitizedValue}%`);
            } else if (key === 'keterangan') {
              query.andWhere('u.keterangan', 'ilike', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`u.${key}`, 'ilike', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'job_text') {
          query.orderBy('c.nobukti', sort.sortDirection);
        } else if (sort?.sortBy === 'tglorder') {
          query.orderBy('d.tglbukti', sort.sortDirection);
        } else if (sort?.sortBy === 'nocontainer') {
          query.orderBy('c.nocontainer', sort.sortDirection);
        } else if (sort?.sortBy === 'noseal') {
          query.orderBy('c.noseal', sort.sortDirection);
        } else if (sort?.sortBy === 'shipper_text') {
          query.orderBy('e.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'nosp') {
          query.orderBy('c.nosp', sort.sortDirection);
        } else if (sort?.sortBy === 'lokasistuffing_text') {
          query.orderBy('f.keterangan', sort.sortDirection);
        } else {
          query.orderBy(`u.${sort.sortBy}`, sort.sortDirection);
        }
      }

      const result = await trx(this.tableName).count('id as total').first();
      const total = result?.total as number;
      const totalPages = Math.ceil(total / limit);
      const data = await query;
      console.log('data', data);
      const responseType = Number(total) > 500 ? 'json' : 'local';

      return {
        data: data,
        type: responseType,
        total,
        pagination: {
          currentPage: Number(page),
          totalPages: totalPages,
          totalItems: total,
          itemsPerPage: limit > 0 ? limit : total,
        },
      };
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async update(tglstatus: string, data: any, trx: any) {
    try {
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        method,
        details,
        ...updatedData
      } = data;

      let result;
      const formatTglStatus = formatDateToSQL(tglstatus);
      const existingData = await trx(this.tableName)
        .where('tglstatus', formatTglStatus)
        .where('jenisorder_id', updatedData.jenisorder_id)
        .where('statusjob', updatedData.statusjob);

      if (existingData.length < 1) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Data Not Found!',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (details && details.length > 0) {
        for (const [index, item] of details.entries()) {
          const payload = {
            statusjob: updatedData.statusjob,
            job: item.job,
            tglstatus: tglstatus,
            keterangan: item.keterangan,
            jenisorder_id: updatedData.jenisorder_id,
            modifiedby: updatedData.modifiedby,
            updated_at: this.utilsService.getTime(),
            created_at: this.utilsService.getTime(),
          };

          Object.keys(payload).forEach((key) => {
            if (typeof payload[key] === 'string') {
              const value = payload[key];
              const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

              if (dateRegex.test(value)) {
                payload[key] = formatDateToSQL(value);
              } else {
                payload[key] = payload[key].toUpperCase();
              }
            }
          });

          result = await trx(this.tableName)
            .where('id', item.id)
            .update(payload)
            .returning('*');

          await this.logTrailService.create(
            {
              namatabel: this.tableName,
              postingdari: `EDIT STATUS JOB`,
              idtrans: result[0].id,
              nobuktitrans: result[0].id,
              aksi: 'ADD',
              datajson: JSON.stringify(result[0]),
              modifiedby: result[0]?.modifiedby,
            },
            trx,
          );
        }
      } else {
        const payload = {
          statusjob: updatedData.statusjob,
          job: data.job,
          tglstatus: tglstatus,
          keterangan: data.keterangan,
          jenisorder_id: updatedData.jenisorder_id,
          modifiedby: updatedData.modifiedby,
          updated_at: this.utilsService.getTime(),
          created_at: this.utilsService.getTime(),
        };

        result = await trx(this.tableName)
          .where('id', data.id)
          .update(payload)
          .returning('*');
        await this.logTrailService.create(
          {
            namatabel: this.tableName,
            postingdari: `EDIT STATUS JOB`,
            idtrans: result[0].id,
            nobuktitrans: result[0].id,
            aksi: 'ADD',
            datajson: JSON.stringify(result[0]),
            modifiedby: result[0]?.modifiedby,
          },
          trx,
        );
      }

      const { data: allData, pagination } = await this.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false,
        },
        trx,
      );

      // let dataIndex = allData.findIndex((item) => item.tglstatus === result[0].tglstatus);
      let dataIndex = allData.findIndex((item) => {
        const tglStatusResult = new Date(result[0].tglstatus).toDateString();
        const [d, m, y] = item.tglstatus.split('-');
        const tglStatusAllData = new Date(`${y}-${m}-${d}`).toDateString();
        return tglStatusResult === tglStatusAllData;
      });
      if (dataIndex === -1) {
        dataIndex = 0;
      }

      const itemsPerPage = limit || 30;
      const pageNumber = Math.floor(dataIndex / itemsPerPage) + 1;
      const endIndex = pageNumber * itemsPerPage;
      const limitedItems = allData.slice(0, endIndex);

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      return {
        pageNumber,
        dataIndex,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      console.error('Error updating status job:', error);
      throw new Error('Failed to update status job');
    }
  }

  async delete(id: any, data: any, trx: any) {
    try {
      let deletedData;
      const grp = data?.grp ? data.grp : 'DATA STATUS JOB';
      const getDataRequest = await trx('parameter')
        .select('id', 'grp', 'subgrp', 'text')
        .where('grp', grp)
        .where('text', data.text)
        .first();
      console.log(
        'MASUK DELETE',
        id,
        data,
        grp,
        getDataRequest,
        getDataRequest.id,
      );

      const getIdStatusJob = await trx(this.tableName)
        .select('*')
        .where('statusjob', getDataRequest.id)
        // .where('job', id)
        .where('jenisorder_id', data.jenisorder_id)
        .modify((query) => {
          if (data?.tglstatus) {
            const formatTglStatus = formatDateToSQL(data.tglstatus);
            query.where('tglstatus', formatTglStatus);
          } else {
            query.where('job', id).first();
          }
        });

      if (getIdStatusJob.length != undefined && getIdStatusJob.length > 0) {
        for (const [index, item] of getIdStatusJob.entries()) {
          deletedData = await this.utilsService.lockAndDestroy(
            item.id,
            this.tableName,
            'id',
            trx,
          );

          await this.logTrailService.create(
            {
              namatabel: this.tableName,
              postingdari: 'DELETE STATUS JOB',
              idtransss: deletedData.id,
              nobuktitrans: deletedData.id,
              aksi: 'DELETE',
              datajson: JSON.stringify(deletedData),
              modifiedby: deletedData.modifiedby,
            },
            trx,
          );
        }
      } else {
        deletedData = await this.utilsService.lockAndDestroy(
          getIdStatusJob.id,
          this.tableName,
          'id',
          trx,
        );
        console.log('deletedData', deletedData);

        await this.logTrailService.create(
          {
            namatabel: this.tableName,
            postingdari: 'DELETE STATUS JOB',
            idtransss: deletedData.id,
            nobuktitrans: deletedData.id,
            aksi: 'DELETE',
            datajson: JSON.stringify(deletedData),
            modifiedby: deletedData.modifiedby,
          },
          trx,
        );
      }

      return {
        status: 200,
        message: 'Data deleted successfully',
        deletedData,
      };
    } catch (error) {
      console.error('Error deleting data: ', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }

  async checkValidasi(
    aksi: string,
    value: any,
    jenisOrderan: any,
    jenisStatusJob: any,
    editedby: any,
    trx: any,
  ) {
    try {
      const formatTglStatus = formatDateToSQL(value);
      const getIdStatusJob = await trx(`${this.tableName} as u`)
        .select(['u.id'])
        .where('tglstatus', formatTglStatus)
        .where('statusjob', jenisStatusJob)
        .where('jenisorder_id', jenisOrderan);

      console.log('aksi', aksi, 'getIdStatusJob', getIdStatusJob);

      if (aksi === 'EDIT') {
        for (const item of getIdStatusJob) {
          const forceEdit = await this.locksService.forceEdit(
            this.tableName,
            item.id,
            editedby,
            trx,
          );

          return forceEdit;
        }
      } else if (aksi === 'DELETE') {
        for (const item of getIdStatusJob) {
          // const forceEdit = await this.locksService.forceEdit(
          //   this.tableName,
          //   item.id,
          //   editedby,
          //   trx,
          // );

          return {
            status: 'success',
            message: 'Data aman untuk dihapus.',
          };
        }
        // return {
        //   status: 'success',
        //   message: 'Data aman untuk dihapus.',
        // };
      }
    } catch (error) {
      console.error('Error di checkValidasi:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }

  async exportToExcel(data: any[], trx: any) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    // Header laporan
    worksheet.mergeCells('A1:I1'); // Ubah dari E1 ke D1 karena hanya 4 kolom
    worksheet.mergeCells('A2:I2'); // Ubah dari E2 ke D2 karena hanya 4 kolom
    worksheet.mergeCells('A3:I3'); // Ubah dari E3 ke D3 karena hanya 4 kolom

    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN STATUS JOB';
    worksheet.getCell('A3').value = 'Data Export';

    ['A1', 'A2', 'A3'].forEach((cellKey, i) => {
      worksheet.getCell(cellKey).alignment = {
        horizontal: 'center',
        vertical: 'middle',
      };
      worksheet.getCell(cellKey).font = {
        name: 'Tahoma',
        size: i === 0 ? 14 : 10,
        bold: true,
      };
    });

    let currentRow = 5;

    for (const h of data) {
      const headerInfo = [
        ['Tgl Status', h.tglstatus ?? ''],
        ['Jenis Orderan', h.jenisorder_nama ?? ''],
        ['Jenis Status', h.statusjob_nama ?? ''],
      ];

      const details = [
        {
          job: h.job_nama,
          tglorder: h.tglorder,
          nocontainer: h.nocontainer,
          noseal: h.noseal,
          shipper: h.shipper_nama,
          nosp: h.nosp,
          lokasistuffing: h.lokasistuffing_nama,
          keterangan: h.keterangan,
        },
      ];

      // Merge kolom A dan B untuk seluruh area header info
      const headerStartRow = currentRow;
      const headerEndRow = currentRow + headerInfo.length - 1;

      headerInfo.forEach(([label, value]) => {
        worksheet.getCell(`A${currentRow}`).value = label;
        worksheet.getCell(`A${currentRow}`).font = {
          bold: true,
          name: 'Tahoma',
          size: 10,
        };
        worksheet.getCell(`C${currentRow}`).value = value;
        worksheet.getCell(`C${currentRow}`).font = {
          name: 'Tahoma',
          size: 10,
        };
        currentRow++;
      });

      for (let row = headerStartRow; row <= headerEndRow; row++) {
        worksheet.mergeCells(`A${row}:B${row}`);
      }

      currentRow++;

      if (details.length > 0) {
        const tableHeaders = [
          'NO.',
          'JOB',
          'TGL ORDER',
          'NO CONTAINER',
          'NO SEAL',
          'SHIPPER',
          'NO SP',
          'LOKASI STUFFING',
          'KETERANGAN',
        ];

        tableHeaders.forEach((header, index) => {
          const cell = worksheet.getCell(currentRow, index + 1);
          cell.value = header;
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFF00' },
          };
          cell.font = {
            bold: true,
            name: 'Tahoma',
            size: 10,
          };
          cell.alignment = {
            horizontal: 'center',
            vertical: 'middle',
          };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
        });
        currentRow++;

        details.forEach((d: any, detailIndex: number) => {
          const rowValues = [
            detailIndex + 1,
            d.job ?? '',
            d.tglorder ?? '',
            d.nocontainer ?? '',
            d.noseal ?? '',
            d.shipper ?? '',
            d.nosp ?? '',
            d.lokasistuffing ?? '',
            d.keterangan ?? '',
          ];

          rowValues.forEach((value, colIndex) => {
            const cell = worksheet.getCell(currentRow, colIndex + 1);
            cell.value = value;
            cell.font = {
              name: 'Tahoma',
              size: 10,
            };

            if (colIndex === 0) {
              cell.alignment = { horizontal: 'center', vertical: 'middle' };
            } else {
              cell.alignment = { horizontal: 'left', vertical: 'middle' };
            }

            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' },
            };
          });
          currentRow++;
        });

        currentRow++;
      }
    }

    worksheet.getColumn(1).width = 6;
    worksheet.getColumn(2).width = 35;
    worksheet.getColumn(3).width = 25;
    worksheet.getColumn(4).width = 30;
    worksheet.getColumn(5).width = 40;
    worksheet.getColumn(6).width = 30;

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_status_job_${Date.now()}.xlsx`,
    );

    await workbook.xlsx.writeFile(tempFilePath);
    return tempFilePath;
  }
}
