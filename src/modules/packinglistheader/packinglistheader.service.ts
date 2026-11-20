import {
  Inject,
  Injectable,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { CreatePackinglistheaderDto } from './dto/create-packinglistheader.dto';
import { UpdatePackinglistheaderDto } from './dto/update-packinglistheader.dto';
import { RedisService } from 'src/common/redis/redis.service';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { JurnalumumdetailService } from '../jurnalumumdetail/jurnalumumdetail.service';
import { StatuspendukungService } from '../statuspendukung/statuspendukung.service';
import { LocksService } from '../locks/locks.service';
import { GlobalService } from '../global/global.service';
import { formatDateToSQL } from 'src/utils/utils.service';
import { HttpStatus } from '@nestjs/common';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { Column, Workbook } from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PackinglistdetailService } from '../packinglistdetail/packinglistdetail.service';

@Injectable()
export class PackinglistheaderService {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly statuspendukungService: StatuspendukungService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly packinglistdetailService: PackinglistdetailService,
  ) {}
  private readonly tableName = 'packinglistheader';
  async create(data: any, trx: any) {
    try {
      console.log(data, 'data');
      // Blanket-uppercase dihapus: schedule_id (FK), statusformat (status),
      // dan id adalah UUID bertipe text (case-sensitive) yang rusak bila
      // di-uppercase. tglbukti sudah diformat eksplisit di payload dan header
      // ini tak punya kolom teks manusiawi untuk di-uppercase.
      if (!data.nobukti) {
        const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
        const parameter = await trx('parameter')
          .select(
            'grp',
            'subgrp',
            'id',
            trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
          )
          .where('grp', 'NOMOR PACKING LIST')
          .andWhere('subgrp', 'NOMOR PACKING LIST')
          .first();

        const nomorBukti =
          await this.runningNumberService.generateRunningNumber(
            trx,
            parameter.grp,
            parameter.subgrp,
            this.tableName,
            String(data.tglbukti),
          );

        data.nobukti = nomorBukti;
      }
      const payload = {
        nobukti: data.nobukti,
        tglbukti: formatDateToSQL(String(data?.tglbukti)),
        schedule_id: data.schedule_id,
        statusformat: data.statusformat,
        info: data.info,
        modifiedby: data.modifiedby,
        created_at: this.utilsService.getTime(),
        updated_at: this.utilsService.getTime(),
      };
      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, payload))
        .returning('*');

      if (data.details && data.details.length > 0) {
        const packinglistdetail = data.details.map((detail: any) => {
          // Susun payload untuk rincian, tidak langsung set rincian mentah
          let rincianPayload: any[] = [];
          if (Array.isArray(detail.rincian) && detail.rincian.length > 0) {
            rincianPayload = detail.rincian.map((rincian: any) => ({
              id: '0',
              nobukti: payload.nobukti,
              packinglistdetail_id: detail.id || 0,
              statuspackinglist_id: rincian.statuspackinglist_id,
              keterangan: rincian.keterangan,
              berat: rincian.berat,
              banyak: rincian.banyak,
              info: rincian.info,
              modifiedby: payload.modifiedby,
              created_at: this.utilsService.getTime(),
              updated_at: this.utilsService.getTime(),
            }));
          }

          return {
            id: '0',
            nobukti: payload.nobukti,
            packinglist_id: insertedItems[0].id,
            orderanmuatan_nobukti: detail.orderanmuatan_nobukti,
            bongkarke: detail.bongkarke,
            info: detail.info,
            modifiedby: payload.modifiedby,
            rincian: rincianPayload,
          };
        });

        await this.packinglistdetailService.create(
          packinglistdetail,
          insertedItems[0].id,
          trx,
        );
      }
      const newItem = insertedItems[0];

      const { data: filteredItems } = await this.findAll(
        {
          search: data.search,
          filters: data.filters,
          pagination: { page: data.page, limit: data.limit },
          sort: { sortBy: data.sortBy, sortDirection: data.sortDirection },
          isLookUp: false,
        },
        trx,
      );

      let itemIndex = filteredItems.findIndex(
        (item) => String(item.id) === String(newItem.id),
      );

      if (itemIndex === -1) {
        itemIndex = 0;
      }

      const pageNumber = Math.floor(itemIndex / data.limit) + 1;
      const endIndex = pageNumber * data.limit;

      const limitedItems = filteredItems.slice(0, endIndex);

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      await this.statuspendukungService.create(
        this.tableName,
        newItem.id,
        data.modifiedby,
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD PACKING LIST HEADER`,
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      return {
        newItem,
        pageNumber,
        itemIndex,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Internal server error',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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

      if (isLookUp) {
        const acoCountResult = await trx(this.tableName)
          .count('id as total')
          .first();

        const acoCount = acoCountResult?.total || 0;

        if (Number(acoCount) > 500) {
          return { data: { type: 'json' } };
        } else {
          limit = 0;
        }
      }

      // const dataTempStatusPendukung = await this.tempStatusPendukung(
      //   trx,
      //   this.tableName,
      // );
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.nobukti', // nobukti (nvarchar(100))
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.schedule_id', // keterangan (text)
          'u.statusformat', // relasi_id (integer)
          trx.raw("TO_CHAR(s.tglberangkat, 'DD-MM-YYYY') as tglberangkat"),
          's.voyberangkat as voyberangkat',
          's.tgltiba as tgltiba',
          's.tglclosing as tglclosing',
          's.statusberangkatkapal as statusberangkatkapal',
          's.statustibakapal as statustibakapal',
          'tk.nama as tujuankapal_nama',
          'k.nama as kapal_nama',
          'u.info', // info (text)
          'u.modifiedby', // modifiedby (varchar(200))
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"), // created_at (datetime)
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"), // updated_at (datetime)
        ])
        .leftJoin('schedulekapal as s', 'u.schedule_id', 's.id')
        .leftJoin('tujuankapal as tk', 's.tujuankapal_id', 'tk.id')
        .leftJoin('kapal as k', 's.kapal_id', 'k.id');

      // .innerJoin(`${dataTempStatusPendukung} as d`, 'u.nobukti', 'd.nobukti');

      if (filters?.tglDari && filters?.tglSampai) {
        // Mengonversi tglDari dan tglSampai ke format yang diterima SQL (YYYY-MM-DD)
        const tglDariFormatted = formatDateToSQL(String(filters?.tglDari)); // Fungsi untuk format
        const tglSampaiFormatted = formatDateToSQL(String(filters?.tglSampai));

        // Menggunakan whereBetween dengan tanggal yang sudah diformat
        query.whereBetween('u.tglbukti', [
          tglDariFormatted,
          tglSampaiFormatted,
        ]);
      }

      const excludeSearchKeys = ['tglDari', 'tglSampai'];
      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );
      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            qb.orWhere(`u.${field}`, 'like', `%${sanitized}%`);
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          // Menambahkan pengecualian untuk 'tglDari' dan 'tglSampai'
          if (key === 'tglDari' || key === 'tglSampai') {
            continue; // Lewati filter jika key adalah 'tglDari' atau 'tglSampai'
          }

          if (value) {
            if (
              key === 'created_at' ||
              key === 'updated_at' ||
              key === 'tglbukti'
            ) {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }

      const result = await trx(this.tableName).count('id as total').first();
      const total = result?.total as number;
      const totalPages = Math.ceil(total / limit);

      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }

      const data = await query;

      const responseType = Number(total) > 500 ? 'json' : 'local';

      return {
        data: data,
        type: responseType,
        total,
        pagination: {
          currentPage: page,
          totalPages: totalPages,
          totalItems: total,
          itemsPerPage: limit,
        },
      };
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async tempStatusPendukung(trx: any, tablename: string) {
    try {
      const tempStatusPendukung = `##temp_${Math.random().toString(36).substring(2, 15)}`;
      const tempData = `##temp_data${Math.random().toString(36).substring(2, 15)}`;
      const tempHasil = `##temp_hasil${Math.random().toString(36).substring(2, 15)}`;

      // Create tempStatusPendukung table
      await trx.schema.createTable(tempStatusPendukung, (t) => {
        t.bigInteger('id').nullable();
        t.bigInteger('statusdatapendukung').nullable();
        t.bigInteger('transaksi_id').nullable();
        t.string('statuspendukung').nullable();
        t.text('keterangan').nullable();
        t.string('modifiedby').nullable();
        t.string('updated_at').nullable();
        t.string('created_at').nullable();
      });

      // Create tempHasil table
      await trx.schema.createTable(tempData, (t) => {
        t.string('nobukti').nullable();
        t.text('keterangan').nullable();
        t.string('judul').nullable();
      });
      await trx.schema.createTable(tempHasil, (t) => {
        t.string('nobukti').nullable();
        t.text('statusapproval').nullable();
        t.text('statuscetak').nullable();
        t.text('keterangan').nullable();
        t.string('statusapproval_id').nullable();
        t.string('tglapproval').nullable();
        t.string('keterangan_cetak').nullable();
        t.string('statuscetak_id').nullable();
        t.string('tglcetak').nullable();
      });

      // Insert into tempStatusPendukung
      await trx(tempStatusPendukung).insert(
        trx
          .select(
            'a.id',
            'a.statusdatapendukung',
            'a.transaksi_id',
            'a.statuspendukung',
            'a.keterangan',
            'a.modifiedby',
            'a.updated_at',
            'a.created_at',
          )
          .from('statuspendukung as a')
          .innerJoin('parameter as b', 'a.statusdatapendukung', 'b.id')
          .where('b.subgrp', tablename),
      );

      await trx(tempData).insert(
        trx
          .select(
            'a.nobukti',
            trx.raw(
              `CONCAT(
                '{"statusdatapendukung":"',
                CASE 
                  WHEN (CAST(c.memo AS text) IS JSON) 
                    THEN JSON_VALUE(CAST(c.memo AS text), '$.MEMO') 
                  ELSE '' 
                END,
                '","transaksi_id":',
                TRIM((COALESCE(b.transaksi_id, 0))::text),
                ',"statuspendukung":"',
                CASE 
                  WHEN (CAST(d.memo AS text) IS JSON) 
                    THEN JSON_VALUE(CAST(d.memo AS text), '$.MEMO') 
                  ELSE '' 
                END,
                '","keterangan":"',
                TRIM(COALESCE(b.keterangan, '')),
                '","updated_at":"',
                TO_CHAR(CAST(b.updated_at AS timestamp), 'YYYY-MM-DD HH24:MI:SS'),
                '","statuspendukung_id":"',
                TRIM((COALESCE(d.id, 0))::text),
                '","statuspendukung_memo":',
               TRIM(CAST(d.memo AS text)),
                '}'
              ) AS keterangan`,
            ),
            trx.raw(
              `CASE 
                WHEN (CAST(c.memo AS text) IS JSON) 
                  THEN JSON_VALUE(CAST(c.memo AS text), '$.MEMO') 
                ELSE '' 
              END AS judul`,
            ),
          )
          .from('jurnalumumheader as a')
          .innerJoin(`${tempStatusPendukung} as b`, 'a.id', 'b.transaksi_id')
          .innerJoin('parameter as c', 'b.statusdatapendukung', 'c.id')
          .innerJoin('parameter as d', 'b.statuspendukung', 'd.id'),
      );

      // Generate dynamic columns for PIVOT
      const columnsResult = await trx
        .select('judul')
        .from(tempData)
        .groupBy('judul');

      let columns = '';
      columnsResult.forEach((row, index) => {
        if (index === 0) {
          columns = `[${row.judul}]`;
        } else {
          columns += `, [${row.judul}]`;
        }
      });

      if (!columns) {
        throw new Error('No columns generated for PIVOT');
      }
      const pivotSubqueryRaw = `
        (
          SELECT nobukti, ${columns}
          FROM (
            SELECT nobukti, judul, keterangan
            FROM ${tempData}
          ) AS SourceTable
          PIVOT (
            MAX(keterangan)
            FOR judul IN (${columns})
          ) AS PivotTable
        ) AS A
      `;
      await trx(tempHasil).insert(
        trx
          .select([
            'A.nobukti',
            trx.raw(
              "JSON_QUERY(A.[approval transaksi], '$.statuspendukung_memo') as statusapproval",
            ),
            trx.raw(
              "JSON_QUERY(A.[cetak], '$.statuspendukung_memo') as statuscetak",
            ),
            trx.raw(
              "JSON_VALUE(A.[approval transaksi], '$.keterangan') as keterangan",
            ),
            trx.raw(
              "JSON_VALUE(A.[approval transaksi], '$.statuspendukung_id') as statusapproval_id",
            ),
            trx.raw(
              "CAST(JSON_VALUE(A.[approval transaksi], '$.updated_at') AS DATETIME) as tglapproval",
            ),
            trx.raw(
              "JSON_VALUE(A.[cetak], '$.keterangan') as keterangan_cetak",
            ),
            trx.raw(
              "JSON_VALUE(A.[cetak], '$.statuspendukung_id') as statuscetak_id",
            ),
            trx.raw(
              "CAST(JSON_VALUE(A.[cetak], '$.updated_at') AS DATETIME) as tglcetak",
            ),
          ])
          .from(trx.raw(pivotSubqueryRaw)),
      );
      return tempHasil;
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }
  async findOne(id: string, trx: any) {
    try {
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.nobukti', // nobukti (nvarchar(100))
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.keterangan', // keterangan (text)
          'u.postingdari', // relasi_id (integer)
          'u.statusformat', // bank_id (integer)
          'u.info', // info (text)
          'u.modifiedby', // modifiedby (varchar(200))
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"), // created_at (datetime)
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"), // updated_at (datetime)
        ])
        .where('u.id', id);

      const data = await query;

      return {
        data: data,
      };
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async update(id: any, data: any, trx: any) {
    try {
      // Blanket-uppercase dihapus: schedule_id (FK), statusformat (status),
      // dan id adalah UUID bertipe text (case-sensitive) yang rusak bila
      // di-uppercase. tglbukti sudah diformat eksplisit di payload dan header
      // ini tak punya kolom teks manusiawi untuk di-uppercase.
      const payload = {
        nobukti: data.nobukti,
        tglbukti: formatDateToSQL(String(data?.tglbukti)),
        schedule_id: data.schedule_id,
        statusformat: data.statusformat,
        info: data.info,
        modifiedby: data.modifiedby,
        created_at: this.utilsService.getTime(),
        updated_at: this.utilsService.getTime(),
      };
      const existingData = await trx(this.tableName).where('id', id).first();
      const hasChanges = this.utilsService.hasChanges(payload, existingData);

      if (hasChanges) {
        payload.updated_at = this.utilsService.getTime();

        await trx(this.tableName).where('id', id).update(payload);
      }
      if (data.details && data.details.length > 0) {
        const packinglistdetail = data.details.map((detail: any) => {
          // Susun payload untuk rincian, tidak langsung set rincian mentah
          let rincianPayload: any[] = [];
          if (Array.isArray(detail.rincian) && detail.rincian.length > 0) {
            rincianPayload = detail.rincian.map((rincian: any) => ({
              id: rincian.id || 0,
              nobukti: payload.nobukti,
              packinglistdetail_id: detail.id || 0,
              statuspackinglist_id: rincian.statuspackinglist_id,
              keterangan: rincian.keterangan,
              berat: rincian.berat,
              banyak: rincian.banyak,
              info: rincian.info,
              modifiedby: payload.modifiedby,
              created_at: this.utilsService.getTime(),
              updated_at: this.utilsService.getTime(),
            }));
          }

          return {
            id: detail.id || 0,
            nobukti: payload.nobukti,
            packinglist_id: id,
            orderanmuatan_nobukti: detail.orderanmuatan_nobukti,
            bongkarke: detail.bongkarke,
            info: detail.info,
            modifiedby: payload.modifiedby,
            rincian: rincianPayload,
          };
        });

        await this.packinglistdetailService.create(packinglistdetail, id, trx);
      }
      const { data: filteredItems } = await this.findAll(
        {
          search: data.search,
          filters: data.filters,
          pagination: { page: data.page, limit: data.limit },
          sort: { sortBy: data.sortBy, sortDirection: data.sortDirection },
          isLookUp: false,
        },
        trx,
      );
      // Cari index item baru di hasil yang sudah difilter
      let itemIndex = filteredItems.findIndex((item) => Number(item.id) === id);

      if (itemIndex === -1) {
        itemIndex = 0;
      }

      const pageNumber = Math.floor(itemIndex / data.limit) + 1;
      const endIndex = pageNumber * data.limit;

      // Ambil data hingga halaman yang mencakup item baru
      const limitedItems = filteredItems.slice(0, endIndex);

      // Simpan ke Redis
      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD KAS GANTUNG HEADER`,
          idtrans: id,
          nobuktitrans: id,
          aksi: 'ADD',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      return {
        updatedItem: {
          id,
          ...data,
        },
        pageNumber,
        itemIndex,
      };
    } catch (error) {
      throw new Error(`${error.message}`);
    }
  }
  async delete(id: string, trx: any, modifiedby: string) {
    try {
      const deletedData = await this.utilsService.lockAndDestroy(
        id,
        this.tableName,
        'id',
        trx,
      );
      await this.packinglistdetailService.delete(id, trx, modifiedby);
      await this.statuspendukungService.remove(id, modifiedby, trx);

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE PACKING LIST HEADER',
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
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }
  // async exportToExcel(data: any[], trx: any) {
  //   const workbook = new Workbook();
  //   const worksheet = workbook.addWorksheet('Data Export');

  //   // Header laporan
  //   worksheet.mergeCells('A1:E1');
  //   worksheet.mergeCells('A2:E2');
  //   worksheet.mergeCells('A3:E3');
  //   worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
  //   worksheet.getCell('A2').value = 'LAPORAN JURNAL UMUM';
  //   worksheet.getCell('A3').value = 'Data Export';
  //   ['A1', 'A2', 'A3'].forEach((cellKey, i) => {
  //     worksheet.getCell(cellKey).alignment = {
  //       horizontal: 'center',
  //       vertical: 'middle',
  //     };
  //     worksheet.getCell(cellKey).font = {
  //       name: 'Tahoma',
  //       size: i === 0 ? 14 : 10,
  //       bold: true,
  //     };
  //   });

  //   let currentRow = 5;

  //   for (const h of data) {
  //     // const detailRes = await this.jurnalumumdetailService.findAll(
  //     //   {
  //     //     filters: {
  //     //       nobukti: h.nobukti,
  //     //     },
  //     //   },
  //     //   trx,
  //     // );
  //     // const details = detailRes.data ?? [];

  //     const headerInfo = [
  //       ['No Bukti', h.nobukti ?? ''],
  //       ['Tanggal Bukti', h.tglbukti ?? ''],
  //       ['Keterangan', h.keterangan ?? ''],
  //     ];

  //     headerInfo.forEach(([label, value]) => {
  //       worksheet.getCell(`A${currentRow}`).value = label;
  //       worksheet.getCell(`A${currentRow}`).font = {
  //         bold: true,
  //         name: 'Tahoma',
  //         size: 10,
  //       };
  //       worksheet.getCell(`B${currentRow}`).value = value;
  //       worksheet.getCell(`B${currentRow}`).font = { name: 'Tahoma', size: 10 };
  //       currentRow++;
  //     });

  //     currentRow++;

  //     if (details.length > 0) {
  //       const tableHeaders = [
  //         'NO.',
  //         'NO BUKTI',
  //         'KETERANGAN',
  //         'COA',
  //         'NOMINAL DEBET',
  //         'NOMINAL KREDIT',
  //       ];
  //       tableHeaders.forEach((header, index) => {
  //         const cell = worksheet.getCell(currentRow, index + 1);
  //         cell.value = header;
  //         cell.fill = {
  //           type: 'pattern',
  //           pattern: 'solid',
  //           fgColor: { argb: 'FFFF00' },
  //         };
  //         cell.font = { bold: true, name: 'Tahoma', size: 10 };
  //         cell.alignment = { horizontal: 'center', vertical: 'middle' };
  //         cell.border = {
  //           top: { style: 'thin' },
  //           left: { style: 'thin' },
  //           bottom: { style: 'thin' },
  //           right: { style: 'thin' },
  //         };
  //       });
  //       currentRow++;

  //       details.forEach((d: any, detailIndex: number) => {
  //         const rowValues = [
  //           detailIndex + 1,
  //           d.nobukti ?? '',
  //           d.keterangan ?? '',
  //           d.coa ?? '',
  //           d.nominaldebet ?? '',
  //           d.nominalkredit ?? '',
  //         ];
  //         rowValues.forEach((value, colIndex) => {
  //           const cell = worksheet.getCell(currentRow, colIndex + 1);
  //           cell.value = value;
  //           cell.font = { name: 'Tahoma', size: 10 };

  //           // kolom angka rata kanan, selain itu rata kiri
  //           if (colIndex === 3 || colIndex === 4 || colIndex === 5) {
  //             // kolom nominal
  //             cell.alignment = { horizontal: 'right', vertical: 'middle' };
  //           } else if (colIndex === 0) {
  //             // kolom nomor
  //             cell.alignment = { horizontal: 'center', vertical: 'middle' };
  //           } else {
  //             cell.alignment = { horizontal: 'left', vertical: 'middle' };
  //           }

  //           cell.border = {
  //             top: { style: 'thin' },
  //             left: { style: 'thin' },
  //             bottom: { style: 'thin' },
  //             right: { style: 'thin' },
  //           };
  //         });
  //         currentRow++;
  //       });

  //       // Tambahkan total nominal
  //       const totalNominal = details.reduce((sum: number, d: any) => {
  //         return sum + (parseFloat(d.nominal) || 0);
  //       }, 0);

  //       // Row total dengan border atas tebal
  //       const totalRow = currentRow;
  //       worksheet.getCell(`A${totalRow}`).value = 'TOTAL';
  //       worksheet.getCell(`A${totalRow}`).font = {
  //         bold: true,
  //         name: 'Tahoma',
  //         size: 10,
  //       };
  //       worksheet.getCell(`A${totalRow}`).alignment = {
  //         horizontal: 'left',
  //         vertical: 'middle',
  //       };
  //       worksheet.getCell(`A${totalRow}`).border = {
  //         top: { style: 'thin' },
  //         left: { style: 'thin' },
  //         bottom: { style: 'thin' },
  //         right: { style: 'thin' },
  //       };

  //       worksheet.mergeCells(`A${totalRow}:C${totalRow}`);

  //       worksheet.getCell(`D${totalRow}`).value = totalNominal;
  //       worksheet.getCell(`D${totalRow}`).font = {
  //         bold: true,
  //         name: 'Tahoma',
  //         size: 10,
  //       };
  //       worksheet.getCell(`D${totalRow}`).alignment = {
  //         horizontal: 'right',
  //         vertical: 'middle',
  //       };
  //       worksheet.getCell(`D${totalRow}`).border = {
  //         top: { style: 'thin' },
  //         left: { style: 'thin' },
  //         bottom: { style: 'thin' },
  //         right: { style: 'thin' },
  //       };

  //       currentRow++;
  //       currentRow++;
  //     }
  //   }

  //   worksheet.columns
  //     .filter((c): c is Column => !!c)
  //     .forEach((col) => {
  //       let maxLength = 0;
  //       col.eachCell({ includeEmpty: true }, (cell) => {
  //         const cellValue = cell.value ? cell.value.toString() : '';
  //         maxLength = Math.max(maxLength, cellValue.length);
  //       });
  //       col.width = maxLength + 2;
  //     });

  //   worksheet.getColumn(1).width = 20;
  //   worksheet.getColumn(2).width = 30;

  //   const tempDir = path.resolve(process.cwd(), 'tmp');
  //   if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  //   const tempFilePath = path.resolve(
  //     tempDir,
  //     `laporan_jurnal_umum${Date.now()}.xlsx`,
  //   );
  //   await workbook.xlsx.writeFile(tempFilePath);

  //   return tempFilePath;
  // }

  // Tambahkan method ini ke dalam class PackinglistheaderService

  async getPackingListReport(packingListHeaderId: number, trx: any) {
    try {
      // Hitung Party berdasarkan container
      const partyCalculation = await trx('packinglistdetail as pd')
        .select([
          'c.nama as container_nama',
          trx.raw('COUNT(DISTINCT pd.orderanmuatan_nobukti) as jumlah_order'),
          trx.raw('COUNT(*) as total_count'),
        ])
        .innerJoin(
          'orderanmuatan as om',
          'pd.orderanmuatan_nobukti',
          'om.nobukti',
        )
        .innerJoin('container as c', 'om.container_id', 'c.id')
        .where('pd.packinglist_id', packingListHeaderId)
        .groupBy('c.nama');

      // Process party string dengan kategorisasi baru
      let partyString = '';
      const partyGroups = {
        '20': 0,
        '40': 0,
        Lainnya: 0,
      };

      for (const row of partyCalculation) {
        const containerName = row.container_nama.toUpperCase();

        // Kategorikan berdasarkan nama container
        let category = '';
        let multiplier = 1;

        // Cek apakah container termasuk kategori 20 (20, 21)
        if (containerName.includes('20') || containerName.includes('21')) {
          category = '20';
          // Extract multiplier jika ada (misal: "2 X 20" → multiplier = 2)
          const match = containerName.match(/(\d+)\s*[xX×]\s*\d+/);
          if (match) {
            multiplier = parseInt(match[1]);
          }
        }
        // Cek apakah container termasuk kategori 40 (40, 41, 42)
        else if (
          containerName.includes('40') ||
          containerName.includes('41') ||
          containerName.includes('42')
        ) {
          category = '40';
          // Extract multiplier jika ada
          const match = containerName.match(/(\d+)\s*[xX×]\s*\d+/);
          if (match) {
            multiplier = parseInt(match[1]);
          }
        }
        // Sisanya masuk kategori Lainnya (CARGO, LCL, CRANE, LCT, dll)
        else {
          category = 'Lainnya';
          multiplier = 1; // Untuk lainnya, dihitung per item
        }

        // Tambahkan ke group yang sesuai
        partyGroups[category] += row.total_count * multiplier;
      }

      // Format party string dengan koma sebagai pemisah
      const partyParts: string[] = [];

      // Urutkan: 20 dulu, lalu 40, lalu Lainnya (jika ada)
      if (partyGroups['20'] > 0) {
        partyParts.push(`${String(partyGroups['20'])} X 20`);
      }
      if (partyGroups['40'] > 0) {
        partyParts.push(`${String(partyGroups['40'])} X 40`);
      }
      if (partyGroups['Lainnya'] > 0) {
        partyParts.push(`${String(partyGroups['Lainnya'])} X Lainnya`);
      }

      partyString = partyParts.join(' , ') || '0';

      // Get header info dengan join ke schedulekapal dan tujuankapal
      const headerInfo = await trx('packinglistheader as ph')
        .select([
          'tk.nama as tujuan',
          'sk.tglberangkat',
          'k.nama as kapal_nama',
        ])
        .leftJoin('schedulekapal as sk', 'ph.schedule_id', 'sk.id')
        .leftJoin('tujuankapal as tk', 'sk.tujuankapal_id', 'tk.id')
        .leftJoin('kapal as k', 'sk.kapal_id', 'k.id')
        .where('ph.id', packingListHeaderId)
        .first();

      // CTE 1: PackingListPivoted dengan modifikasi untuk alamat bongkar dan container/seal
      const packingListPivoted = trx('packinglistdetail as pd')
        .select([
          'pd.id as packinglistdetail_id',
          'pd.orderanmuatan_nobukti',
          'pd.bongkarke',
          'pd.info as detail_info',
          'ph.nobukti as header_nobukti',
          's.nama as shipper_nama',
          // Container dan Seal dari orderanmuatan
          'om.nocontainer',
          'om.noseal',
          // Alamat bongkar dari packinglistdetailrincian dengan status 215
          trx.raw(`(
            SELECT TOP 1 pdr_alamat.keterangan 
            FROM packinglistdetailrincian pdr_alamat
            WHERE pdr_alamat.packinglistdetail_id = pd.id 
            AND pdr_alamat.statuspackinglist_id = 215
          ) AS alamat_bongkar`),
          // Container info untuk debugging (optional)
          'c.nama as container_nama',
          // Agregasi rincian per status
          trx.raw(`STRING_AGG(
            CASE WHEN pdr.statuspackinglist_id = 216 
            THEN pdr.keterangan END, '|'
          ) AS lampiran_list`),
          trx.raw(`STRING_AGG(
            CASE WHEN pdr.statuspackinglist_id = 217 
            THEN pdr.keterangan END, '|'
          ) AS keterangan_list`),
          trx.raw(`STRING_AGG(
            CASE WHEN pdr.statuspackinglist_id = 220 
            THEN pdr.keterangan END, '|'
          ) AS uraian_list`),
          // Hitung jumlah masing-masing
          trx.raw(`COUNT(
            CASE WHEN pdr.statuspackinglist_id = 216 
            THEN 1 END
          ) AS lampiran_count`),
          trx.raw(`COUNT(
            CASE WHEN pdr.statuspackinglist_id = 217 
            THEN 1 END
          ) AS keterangan_count`),
          trx.raw(`COUNT(
            CASE WHEN pdr.statuspackinglist_id = 220 
            THEN 1 END
          ) AS uraian_count`),
        ])
        .innerJoin('packinglistheader as ph', 'ph.id', 'pd.packinglist_id')
        .leftJoin('packinglistdetailrincian as pdr', function () {
          this.on('pd.id', '=', 'pdr.packinglistdetail_id').andOnIn(
            'pdr.statuspackinglist_id',
            [216, 217, 220], // Tidak termasuk 215 karena sudah dihandle terpisah
          );
        })
        .leftJoin(
          'orderanmuatan as om',
          'pd.orderanmuatan_nobukti',
          'om.nobukti',
        )
        .leftJoin('container as c', 'om.container_id', 'c.id')
        .leftJoin('shipper as s', 'om.shipper_id', 's.id')
        .where('ph.id', packingListHeaderId)
        .groupBy([
          'pd.id',
          'pd.orderanmuatan_nobukti',
          'pd.bongkarke',
          'pd.info',
          'ph.nobukti',
          's.nama',
          'om.nocontainer',
          'om.noseal',
          'c.nama',
        ]);

      // Create temporary table for PackingListPivoted
      const tempPackingListPivoted = `##temp_plp_${Math.random().toString(36).substring(2, 15)}`;
      await trx.schema.createTable(tempPackingListPivoted, (t) => {
        t.bigInteger('packinglistdetail_id');
        t.string('orderanmuatan_nobukti', 100);
        t.integer('bongkarke');
        t.text('detail_info');
        t.string('header_nobukti', 100);
        t.string('shipper_nama', 255);
        t.string('nocontainer', 100);
        t.string('noseal', 100);
        t.text('alamat_bongkar');
        t.string('container_nama', 100);
        t.text('lampiran_list');
        t.text('keterangan_list');
        t.text('uraian_list');
        t.integer('lampiran_count');
        t.integer('keterangan_count');
        t.integer('uraian_count');
      });

      await trx(tempPackingListPivoted).insert(packingListPivoted);

      // CTE 2: SplitData dengan CROSS APPLY STRING_SPLIT
      const tempSplitData = `##temp_sd_${Math.random().toString(36).substring(2, 15)}`;
      await trx.schema.createTable(tempSplitData, (t) => {
        t.bigInteger('packinglistdetail_id');
        t.string('orderanmuatan_nobukti', 100);
        t.integer('bongkarke');
        t.text('detail_info');
        t.string('header_nobukti', 100);
        t.string('shipper_nama', 255);
        t.string('nocontainer', 100);
        t.string('noseal', 100);
        t.text('alamat_bongkar');
        t.text('lampiran_list');
        t.text('keterangan_list');
        t.text('uraian_list');
        t.integer('lampiran_count');
        t.integer('keterangan_count');
        t.integer('uraian_count');
        t.text('split_value');
        t.bigInteger('rn');
      });

      // Insert ke SplitData dengan STRING_SPLIT
      await trx.raw(`
        INSERT INTO ${tempSplitData}
        SELECT 
          packinglistdetail_id,
          orderanmuatan_nobukti,
          bongkarke,
          detail_info,
          header_nobukti,
          shipper_nama,
          nocontainer,
          noseal,
          alamat_bongkar,
          lampiran_list,
          keterangan_list,
          uraian_list,
          lampiran_count,
          keterangan_count,
          uraian_count,
          CASE 
            WHEN lampiran_count > 1 OR keterangan_count > 1 OR uraian_count > 1
            THEN LTRIM(RTRIM(value))
            ELSE 'single_row'
          END AS split_value,
          ROW_NUMBER() OVER (PARTITION BY packinglistdetail_id ORDER BY (SELECT NULL)) AS rn
        FROM ${tempPackingListPivoted}
        CROSS APPLY STRING_SPLIT(
          CASE 
            WHEN lampiran_count > 1 OR keterangan_count > 1 OR uraian_count > 1
            THEN CONCAT(
              COALESCE(lampiran_list, ''), '|', 
              COALESCE(keterangan_list, ''), '|', 
              COALESCE(uraian_list, '')
            )
            ELSE 'single_row'
          END, '|'
        )
      `);

      // CTE 3: ExpandedRows
      const tempExpandedRows = `##temp_er_${Math.random().toString(36).substring(2, 15)}`;
      await trx.schema.createTable(tempExpandedRows, (t) => {
        t.bigInteger('packinglistdetail_id');
        t.string('orderanmuatan_nobukti', 100);
        t.integer('bongkarke');
        t.text('detail_info');
        t.string('header_nobukti', 100);
        t.string('shipper_nama', 255);
        t.string('nocontainer', 100);
        t.string('noseal', 100);
        t.text('alamat_bongkar');
        t.text('lampiran_dokumen');
        t.text('keterangan');
        t.text('uraian');
        t.bigInteger('rn');
      });

      await trx.raw(`
        INSERT INTO ${tempExpandedRows}
        SELECT 
          packinglistdetail_id,
          orderanmuatan_nobukti,
          bongkarke,
          detail_info,
          header_nobukti,
          shipper_nama,
          nocontainer,
          noseal,
          alamat_bongkar,
          CASE 
            WHEN lampiran_count <= 1 AND keterangan_count <= 1 AND uraian_count <= 1 
            THEN lampiran_list
            WHEN split_value != '' AND split_value != 'single_row'
            THEN split_value
            ELSE NULL
          END AS lampiran_dokumen,
          CASE 
            WHEN lampiran_count <= 1 AND keterangan_count <= 1 AND uraian_count <= 1 
            THEN keterangan_list
            ELSE NULL
          END AS keterangan,
          CASE 
            WHEN lampiran_count <= 1 AND keterangan_count <= 1 AND uraian_count <= 1 
            THEN uraian_list
            ELSE NULL
          END AS uraian,
          rn
        FROM ${tempSplitData}
        WHERE split_value != '' OR split_value = 'single_row'
      `);

      // Final SELECT dengan ROW_NUMBER dan Container/Seal dari orderanmuatan
      const result = await trx.raw(`
        SELECT 
          ROW_NUMBER() OVER (ORDER BY packinglistdetail_id, rn) AS No,
          packinglistdetail_id AS [Detail ID],
          CASE WHEN rn = 1 THEN orderanmuatan_nobukti ELSE '' END AS Job,
          CASE WHEN rn = 1 
            THEN CONCAT(COALESCE(nocontainer, ''), ' / ', COALESCE(noseal, ''))
            ELSE '' 
          END AS [Container / Seal],
          CASE WHEN rn = 1 THEN COALESCE(shipper_nama, '') ELSE '' END AS Shipper,
          CASE WHEN rn = 1 THEN bongkarke ELSE NULL END AS Bkr,
          COALESCE(lampiran_dokumen, '') AS [Lampiran Dokumen],
          CASE WHEN rn = 1 THEN COALESCE(alamat_bongkar, '') ELSE '' END AS [Alamat Bongkar],
          COALESCE(keterangan, '') AS Keterangan,
          COALESCE(uraian, '') AS Uraian
        FROM ${tempExpandedRows}
        ORDER BY packinglistdetail_id, rn
      `);

      // Cleanup temporary tables
      await trx.schema.dropTableIfExists(tempPackingListPivoted);
      await trx.schema.dropTableIfExists(tempSplitData);
      await trx.schema.dropTableIfExists(tempExpandedRows);

      return {
        party: partyString,
        tujuan: headerInfo?.tujuan || '',
        tglberangkat: headerInfo?.tglberangkat || null,
        kapal_nama: headerInfo?.kapal_nama || '',
        data: result,
        message: 'Packing list report generated successfully',
      };
    } catch (error) {
      console.error('Error generating packing list report:', error);
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Failed to generate packing list report',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getPackingListSimpleReport(packingListHeaderId: number, trx: any) {
    try {
      // Query utama untuk mendapatkan data packing list
      const result = await trx('packinglistdetail as pd')
        .select([
          // Pengirim dari shipper
          's.nama as pengirim',
          // Kapal dari schedulekapal
          'k.nama as kapal',
          // Tanggal kapal dari schedulekapal
          'sk.tglberangkat as tglkapal',
          // Tujuan dari orderanmuatan → tujuankapal
          'tk.nama as tujuan',
          // Penerima - aggregasi dari packinglistdetailrincian status 215
          trx.raw(`(
            SELECT STRING_AGG(pdr_penerima.keterangan, ', ')
            FROM packinglistdetailrincian pdr_penerima
            WHERE pdr_penerima.packinglistdetail_id = pd.id 
            AND pdr_penerima.statuspackinglist_id = 215
          ) AS penerima`),
          trx.raw(`(
            SELECT MAX(pdr_banyak.banyak)
            FROM packinglistdetailrincian pdr_banyak
            WHERE pdr_banyak.packinglistdetail_id = pd.id 
            AND pdr_banyak.statuspackinglist_id = 220
          ) AS banyak`),

          trx.raw(`(
            SELECT MAX(pdr_berat.berat)
            FROM packinglistdetailrincian pdr_berat
            WHERE pdr_berat.packinglistdetail_id = pd.id 
            AND pdr_berat.statuspackinglist_id = 220
          ) AS berat`),
          trx.raw(`(
            SELECT MAX(pdr_keterangan.keterangan)
            FROM packinglistdetailrincian pdr_keterangan
            WHERE pdr_keterangan.packinglistdetail_id = pd.id 
            AND pdr_keterangan.statuspackinglist_id = 217
          ) AS keterangan`),

          // No Truck dari orderanmuatan
          'om.nopolisi as notruck',
          // Container nama dari container table
          'pd.orderanmuatan_nobukti as nomorbuktiorderanmuatan',
          'c.nama as container_nama',
          // Container seal gabungan nocontainer dan noseal
          trx.raw(
            `CONCAT(COALESCE(om.nocontainer, ''), ' / ', COALESCE(om.noseal, '')) AS container_seal`,
          ),
        ])
        .innerJoin('packinglistheader as ph', 'ph.id', 'pd.packinglist_id')
        // Join ke orderanmuatan
        .leftJoin(
          'orderanmuatan as om',
          'pd.orderanmuatan_nobukti',
          'om.nobukti',
        )
        // Join ke shipper untuk mendapatkan nama pengirim
        .leftJoin('shipper as s', 'om.shipper_id', 's.id')
        // Join ke container untuk mendapatkan nama container
        .leftJoin('container as c', 'om.container_id', 'c.id')
        // Join ke tujuankapal dari orderanmuatan untuk mendapatkan tujuan
        .leftJoin('tujuankapal as tk', 'om.tujuankapal_id', 'tk.id')
        // Join ke schedulekapal untuk mendapatkan kapal dan tanggal
        .leftJoin('schedulekapal as sk', 'ph.schedule_id', 'sk.id')
        // Join ke kapal untuk mendapatkan nama kapal
        .leftJoin('kapal as k', 'sk.kapal_id', 'k.id')
        .where('ph.id', packingListHeaderId)
        .orderBy('pd.id');

      // Format hasil
      const formattedData = result.map((row) => ({
        pengirim: row.pengirim || '',
        kapal: row.kapal || '',
        tglkapal: row.tglkapal ? this.formatDate(row.tglkapal) : '',
        tujuan: row.tujuan || '',
        penerima: row.penerima || '',
        banyak: row.banyak || '',
        berat: row.berat || '',
        keterangan: row.keterangan || '',
        notruck: row.notruck || '',
        nomorbuktiorderanmuatan: row.nomorbuktiorderanmuatan || '',
        container_nama: row.container_nama || '',
        container_seal: row.container_seal || ' / ',
      }));

      return {
        data: formattedData,
        message: 'Simple packing list report generated successfully',
      };
    } catch (error) {
      console.error('Error generating simple packing list report:', error);
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message:
            error.message || 'Failed to generate simple packing list report',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Helper function untuk format tanggal (optional)
  formatDate(date: Date | string): string {
    if (!date) return '';
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  async checkValidasi(aksi: string, value: any, editedby: any, trx: any) {
    try {
      if (aksi === 'EDIT') {
        const forceEdit = await this.locksService.forceEdit(
          this.tableName,
          value,
          editedby,
          trx,
        );

        return forceEdit;
      } else if (aksi === 'DELETE') {
        const validasi = await this.globalService.checkUsed(
          'pengembalianjurnalumumdetail',
          'jurnalumum_nobukti',
          value,
          trx,
        );

        return validasi;
      }
    } catch (error) {
      console.error('Error di checkValidasi:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }
}
