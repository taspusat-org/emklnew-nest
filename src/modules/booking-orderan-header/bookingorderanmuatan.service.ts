import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Column, Workbook } from 'exceljs';
import { LocksService } from '../locks/locks.service';
import {
  withUuidV7,
  formatDateToSQL,
  tandatanya,
  UtilsService,
 } from 'src/utils/utils.service';
import { GlobalService } from '../global/global.service';
import { RedisService } from 'src/common/redis/redis.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { dbMssql } from 'src/common/utils/db';
import { StatuspendukungService } from '../statuspendukung/statuspendukung.service';

@Injectable()
export class BookingOrderanMuatanService {
  private readonly tableName: string = 'bookingorderanmuatan';

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
    private readonly statuspendukungService: StatuspendukungService,
  ) {}

  async create(createData: any, trx: any) {
    try {
      const {
        id,
        jenisOrderan,
        tglDari,
        tglSampai,
        container_nama,
        shipper_nama,
        tujuankapal_nama,
        marketing_nama,
        schedule_nama,
        pelayarancontainer_nama,
        jenismuatan_nama,
        sandarkapal_nama,
        tradoluar,
        tradoluar_nama,
        lokasistuffing_nama,
        emkllain_nama,
        daftarbl_nama,
        pisahbl,
        pisahbl_nama,
        jobptd,
        jobptd_nama,
        transit,
        transit_nama,
        stuffingdepo,
        stuffingdepo_nama,
        opendoor,
        opendoor_nama,
        batalmuat,
        batalmuat_nama,
        soc,
        soc_nama,
        pengurusandoorekspedisilain,
        pengurusandoorekspedisilain_nama,
        kapal,
        kapal_nama,
        voyberangkat,
        tglberangkat,
        hargatrucking,
        hargatrucking_nama,
        estmuat,
        ...insertData
      } = createData;

      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      [
        'nobukti',
        'keterangan',
        'nopolisi',
        'nosp',
        'nocontainer',
        'noseal',
        'asalmuatan',
        'comodity',
        'gandengan',
      ].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      insertData.updated_at = this.utilsService.getTime();
      insertData.created_at = this.utilsService.getTime();

      const insertedData = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

      const newItem = insertedData[0];

      const dataPendukungMuatan = {
        'TRADO LUAR': tradoluar,
        'PISAH BL': pisahbl,
        'JOB PTD': jobptd,
        TRANSIT: transit,
        'STUFFING DEPO': stuffingdepo,
        'OPEN DOOR': opendoor,
        'BATAL MUAT': batalmuat,
        SOC: soc,
        'PENGURUSAN DOOR EKSPEDISI LAIN': pengurusandoorekspedisilain,
      };

      const createDataStatusPendukung =
        await this.statuspendukungService.create(
          this.tableName,
          newItem.id,
          newItem.modifiedby,
          trx,
          dataPendukungMuatan,
        );

      await this.logTrailService.create(
        {
          namatable2: this.tableName,
          postingdari: 'ADD BOOKING ORDERAN MUATAN',
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
      };
    } catch (error) {
      throw new Error(
        `Error creating booking orderan muatan: ${error.message}`,
      );
    }
  }

  async findAll(
    { search, filters, pagination, sort, isLookUp }: FindAllParams,
    trx: any,
  ) {
    try {
      console.log('MASUKK KE MUATAN??');

      let { page, limit } = pagination ?? {};
      page = page ?? 1;
      limit = limit ?? 0;

      const tempUrl = `##temp_url_${Math.random().toString(36).substring(2, 8)}`;

      await trx.schema.createTable(tempUrl, (t) => {
        t.integer('id').nullable();
        t.string('orderan_nobukti').nullable();
        t.text('link').nullable();
      });
      const url = 'orderanmuatan';

      await trx(tempUrl).insert(
        trx
          .select(
            'u.id',
            'u.orderan_nobukti',
            trx.raw(`
                    STRING_AGG(
                      '<a target="_blank" className="link-color" href="/dashboard/${url}' + ${tandatanya} + 'orderan_nobukti=' + u.orderan_nobukti + '">' +
                      '<HighlightWrapper value="' + u.orderan_nobukti + '" />' +
                      '</a>', ','
                    ) AS link
                  `),
          )
          .from('bookingorderanheader as u')
          .groupBy('u.id', 'u.orderan_nobukti'),
      );

      const fieldTempHasil = [
        // 'nobukti',
        'tradoluar',
        'tradoluar_nama',
        'tradoluar_memo',
        'pisahbl',
        'pisahbl_nama',
        'pisahbl_memo',
        'jobptd',
        'jobptd_nama',
        'jobptd_memo',
        'transit',
        'transit_nama',
        'transit_memo',
        'stuffingdepo',
        'stuffingdepo_nama',
        'stuffingdepo_memo',
        'opendoor',
        'opendoor_nama',
        'opendoor_memo',
        'batalmuat',
        'batalmuat_nama',
        'batalmuat_memo',
        'soc',
        'soc_nama',
        'soc_memo',
        'pengurusandoor',
        'pengurusandoor_nama',
        'pengurusandoor_memo',
        'approval',
        'approval_nama',
        'approval_memo',
      ];

      const dataTempStatusPendukung =
        await this.utilsService.tempPivotStatusPendukung(
          trx,
          this.tableName,
          fieldTempHasil,
        );

      const query = trx
        .from(trx.raw(`${this.tableName} as u`))
        .select([
          'u.id as id',
          'u.bookingorderan_id',
          'u.nobukti',
          'u.container_id',
          'u.shipper_id',
          'u.tujuankapal_id',
          'u.marketing_id',
          'u.keterangan',
          'u.schedule_id',
          'u.pelayarancontainer_id',
          'u.jenismuatan_id',
          'u.sandarkapal_id',
          'u.nopolisi',
          'u.nosp',
          'u.nocontainer',
          'u.noseal',
          'u.lokasistuffing',
          'u.nominalstuffing',
          'u.emkllain_id',
          'u.asalmuatan',
          'u.daftarbl_id',
          'u.comodity',
          'u.gandengan',
          'u.modifiedby',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),

          'header.id as header_id',
          'header.nobukti as header_nobukti',
          trx.raw("TO_CHAR(header.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'header.jenisorder_id',
          'jenisorderan.nama as jenisorder_nama',
          'header.statusformat',
          'header.orderan_nobukti as orderan_nobukti',
          'tempUrl.link',

          'container.nama as container_nama',
          'shipper.nama as shipper_nama',
          'tujuankapal.nama as tujuankapal_nama',
          'marketing.nama as marketing_nama',
          'schedulekapal.voyberangkat as schedule_nama',
          'pelayaran.nama as pelayarancontainer_nama',
          'jenismuatan.nama as jenismuatan_nama',
          'sandarkapal.nama as sandarkapal_nama',
          'hargatrucking.keterangan as lokasistuffing_nama',
          'emkl.nama as emkllain_nama',
          'daftarbl.nama as daftarbl_nama',

          'pivot.tradoluar as tradoluar',
          'pivot.tradoluar_nama as tradoluar_nama',
          'pivot.tradoluar_memo as tradoluar_memo',
          'pivot.pisahbl as pisahbl',
          'pivot.pisahbl_nama as pisahbl_nama',
          'pivot.pisahbl_memo as pisahbl_memo',
          'pivot.jobptd as jobptd',
          'pivot.jobptd_nama as jobptd_nama',
          'pivot.jobptd_memo as jobptd_memo',
          'pivot.transit as transit',
          'pivot.transit_nama as transit_nama',
          'pivot.transit_memo as transit_memo',
          'pivot.stuffingdepo as stuffingdepo',
          'pivot.stuffingdepo_nama as stuffingdepo_nama',
          'pivot.stuffingdepo_memo as stuffingdepo_memo',
          'pivot.opendoor as opendoor',
          'pivot.opendoor_nama as opendoor_nama',
          'pivot.opendoor_memo as opendoor_memo',
          'pivot.batalmuat as batalmuat',
          'pivot.batalmuat_nama as batalmuat_nama',
          'pivot.batalmuat_memo as batalmuat_memo',
          'pivot.soc as soc',
          'pivot.soc_nama as soc_nama',
          'pivot.soc_memo as soc_memo',
          'pivot.pengurusandoor as pengurusandoor',
          'pivot.pengurusandoor_nama as pengurusandoor_nama',
          'pivot.pengurusandoor_memo as pengurusandoor_memo',
          'pivot.approval as approval',
          'pivot.approval_nama as approval_nama',
          'pivot.approval_memo as approval_memo',
        ])
        .leftJoin(
          'bookingorderanheader as header',
          'u.nobukti',
          'header.nobukti',
        )
        .leftJoin(
          trx.raw(`${tempUrl} as tempUrl`),
          'header.orderan_nobukti',
          'tempUrl.orderan_nobukti',
        )
        .leftJoin('jenisorder as jenisorderan', 'header.jenisorder_id', 'jenisorderan.id')
        .leftJoin('container', 'u.container_id', 'container.id')
        .leftJoin('shipper', 'u.shipper_id', 'shipper.id')
        .leftJoin('tujuankapal', 'u.tujuankapal_id', 'tujuankapal.id')
        .leftJoin('marketing', 'u.marketing_id', 'marketing.id')
        .leftJoin('schedulekapal', 'u.schedule_id', 'schedulekapal.id')
        .leftJoin('pelayaran', 'u.pelayarancontainer_id', 'pelayaran.id')

        .leftJoin('jenismuatan', 'u.jenismuatan_id', 'jenismuatan.id')
        .leftJoin('sandarkapal', 'u.sandarkapal_id', 'sandarkapal.id')
        .leftJoin('hargatrucking', 'u.lokasistuffing', 'hargatrucking.id')
        .leftJoin('emkl', 'u.emkllain_id', 'emkl.id')
        .leftJoin('daftarbl', 'u.daftarbl_id', 'daftarbl.id')
        .leftJoin(
          `${dataTempStatusPendukung} as pivot`,
          'u.nobukti',
          'pivot.nobukti',
        );

      if (filters?.tglDari && filters?.tglSampai) {
        const tglDariFormatted = formatDateToSQL(String(filters?.tglDari));
        const tglSampaiFormatted = formatDateToSQL(String(filters?.tglSampai));

        query.whereBetween('header.tglbukti', [
          tglDariFormatted,
          tglSampaiFormatted,
        ]);
      }

      if (search) {
        const sanitizedValue = String(search).replace(/\[/g, '[[]');
        query.where((builder) => {
          builder
            .orWhere('u.nobukti', 'like', `%${sanitizedValue}%`)
            .orWhere('u.keterangan', 'like', `%${sanitizedValue}%`)
            .orWhere('u.nopolisi', 'like', `%${sanitizedValue}%`)
            .orWhere('u.nosp', 'like', `%${sanitizedValue}%`)
            .orWhere('u.nocontainer', 'like', `%${sanitizedValue}%`)
            .orWhere('u.noseal', 'like', `%${sanitizedValue}%`)
            .orWhere('u.nominalstuffing', 'like', `%${sanitizedValue}%`)
            .orWhere('u.asalmuatan', 'like', `%${sanitizedValue}%`)
            .orWhere('u.comodity', 'like', `%${sanitizedValue}%`)
            .orWhere('u.gandengan', 'like', `%${sanitizedValue}%`)
            .orWhere('u.modifiedby', 'like', `%${sanitizedValue}%`)
            .orWhereRaw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
              `%${sanitizedValue}%`,
            ])
            .orWhereRaw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
              `%${sanitizedValue}%`,
            ])
            .orWhereRaw("TO_CHAR(header.tglbukti, 'DD-MM-YYYY') LIKE ?", [
              `%${sanitizedValue}%`,
            ])
            .orWhere('header.orderan_nobukti', 'like', `%${sanitizedValue}%`)
            .orWhere('container.nama', 'like', `%${sanitizedValue}%`)
            .orWhere('shipper.nama', 'like', `%${sanitizedValue}%`)
            .orWhere('tujuankapal.nama', 'like', `%${sanitizedValue}%`)
            .orWhere('marketing.nama', 'like', `%${sanitizedValue}%`)
            .orWhere(
              'schedulekapal.voyberangkat',
              'like',
              `%${sanitizedValue}%`,
            )
            .orWhere('pelayaran.nama', 'like', `%${sanitizedValue}%`)
            .orWhere('jenismuatan.nama', 'like', `%${sanitizedValue}%`)
            .orWhere('sandarkapal.nama', 'like', `%${sanitizedValue}%`)
            .orWhere('hargatrucking.keterangan', 'like', `%${sanitizedValue}%`)
            .orWhere('emkl.nama', 'like', `%${sanitizedValue}%`)
            .orWhere('daftarbl.nama', 'like', `%${sanitizedValue}%`)
            .orWhere('marketing.nama', 'like', `%${sanitizedValue}%`);
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          if (
            key === 'tglDari' ||
            key === 'tglSampai' ||
            key === 'jenisOrderan'
          ) {
            continue; // Lewati filter jika key adalah 'tglDari' atau 'tglSampai'
          }

          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'tglbukti') {
              query.andWhereRaw("TO_CHAR(header.??, 'DD-MM-YYYY') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'orderan_nobukti') {
              query.andWhere(
                'header.orderan_nobukti',
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'jenisorder_text') {
              query.andWhere(
                'jenisorderan.nama',
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'container_text') {
              query.andWhere('container.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'shipper_text') {
              query.andWhere('shipper.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'tujuankapal_text') {
              query.andWhere('tujuankapal.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'marketing_text') {
              query.andWhere('marketing.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'schedule_text') {
              query.andWhere(
                'schedulekapal.voyberangkat',
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'pelayarancontainer_text') {
              query.andWhere('pelayaran.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'jenismuatan_text') {
              query.andWhere('jenismuatan.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'sandarkapal_text') {
              query.andWhere('sandarkapal.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'lokasistuffing_text') {
              query.andWhere(
                'hargatrucking.keterangan',
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'emkllain_text') {
              query.andWhere('emkl.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'daftarbl_text') {
              query.andWhere('daftarbl.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'tradoluar_text') {
              query.andWhere('pivot.tradoluar', '=', sanitizedValue);
            } else if (key === 'pisahbl_text') {
              query.andWhere('pivot.pisahbl', '=', sanitizedValue);
            } else if (key === 'jobptd_text') {
              query.andWhere('pivot.jobptd', '=', sanitizedValue);
            } else if (key === 'transit_text') {
              query.andWhere('pivot.transit', '=', sanitizedValue);
            } else if (key === 'stuffingdepo_text') {
              query.andWhere('pivot.stuffingdepo', '=', sanitizedValue);
            } else if (key === 'opendoor_text') {
              query.andWhere('pivot.opendoor', '=', sanitizedValue);
            } else if (key === 'batalmuat_text') {
              query.andWhere('pivot.batalmuat', '=', sanitizedValue);
            } else if (key === 'soc_text') {
              query.andWhere('pivot.soc', '=', sanitizedValue);
            } else if (key === 'pengurusandoor_text') {
              query.andWhere('pivot.pengurusandoor', '=', sanitizedValue);
            } else if (key === 'approval_text') {
              query.andWhere('pivot.approval', '=', sanitizedValue);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'jenisorder_text') {
          query.orderBy('jenisorderan.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'container_text') {
          query.orderBy('container.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'shipper_text') {
          query.orderBy('shipper.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'tujuankapal_text') {
          query.orderBy('tujuankapal.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'marketing_text') {
          query.orderBy('marketing.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'schedule_text') {
          query.orderBy('schedulekapal.voyberangkat', sort.sortDirection);
        } else if (sort?.sortBy === 'pelayarancontainer_text') {
          query.orderBy('pelayaran.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'jenismuatan_text') {
          query.orderBy('jenismuatan.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'sandarkapal_text') {
          query.orderBy('sandarkapal.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'lokasistuffing_text') {
          query.orderBy('hargatrucking.keterangan', sort.sortDirection);
        } else if (sort?.sortBy === 'emkllain_text') {
          query.orderBy('emkl.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'daftarbl_text') {
          query.orderBy('daftarbl.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'statustradoluar') {
          query.orderByRaw(
            `JSON_VALUE([pivot].tradoluar_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statuspisahbl') {
          query.orderByRaw(
            `JSON_VALUE([pivot].pisahbl_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statusjobptd') {
          query.orderByRaw(
            `JSON_VALUE([pivot].jobptd_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statustransit') {
          query.orderByRaw(
            `JSON_VALUE([pivot].transit_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statusstuffingdepo') {
          query.orderByRaw(
            `JSON_VALUE([pivot].stuffingdepo_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statusopendoor') {
          query.orderByRaw(
            `JSON_VALUE([pivot].opendoor_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statusbatalmuat') {
          query.orderByRaw(
            `JSON_VALUE([pivot].batalmuat_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statussoc') {
          query.orderByRaw(
            `JSON_VALUE([pivot].soc_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statuspengurusandoor') {
          query.orderByRaw(
            `JSON_VALUE([pivot].pengurusandoor_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else if (sort?.sortBy === 'statusapproval') {
          query.orderByRaw(
            `JSON_VALUE([pivot].approval_memo, '$.MEMO') ${sort.sortDirection}`,
          );
        } else {
          query.orderBy(sort.sortBy, sort.sortDirection);
        }
      }

      const result = await trx(this.tableName).count('id as total').first();
      const total = result?.total as number;
      const totalPages = Math.ceil(total / limit);
      const data = await query;
      const responseType = Number(total) > 500 ? 'json' : 'local';
      // console.log('data', data);

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
      console.error('Error to findAll Booking Orderan Muatan', error);
      throw new Error(error);
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
        t.text('tradoluar').nullable();
        t.text('tradoluar_nama').nullable();
        t.text('tradoluar_memo').nullable();
        t.text('pisahbl').nullable();
        t.text('pisahbl_nama').nullable();
        t.text('pisahbl_memo').nullable();
        t.text('jobptd').nullable();
        t.text('jobptd_nama').nullable();
        t.text('jobptd_memo').nullable();
        t.text('transit').nullable();
        t.text('transit_nama').nullable();
        t.text('transit_memo').nullable();
        t.text('stuffingdepo').nullable();
        t.text('stuffingdepo_nama').nullable();
        t.text('stuffingdepo_memo').nullable();
        t.text('opendoor').nullable();
        t.text('opendoor_nama').nullable();
        t.text('opendoor_memo').nullable();
        t.text('batalmuat').nullable();
        t.text('batalmuat_nama').nullable();
        t.text('batalmuat_memo').nullable();
        t.text('soc').nullable();
        t.text('soc_nama').nullable();
        t.text('soc_memo').nullable();
        t.text('pengurusandoor').nullable();
        t.text('pengurusandoor_nama').nullable();
        t.text('pengurusandoor_memo').nullable();
        t.text('approval').nullable();
        t.text('approval_nama').nullable();
        t.text('approval_memo').nullable();
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
          .from(`${tablename} as a`)
          .innerJoin(`${tempStatusPendukung} as b`, 'a.id', 'b.transaksi_id')
          .innerJoin('parameter as c', 'b.statusdatapendukung', 'c.id')
          .innerJoin('parameter as d', 'b.statuspendukung', 'd.id'),
      );
      // console.log('tempData', await trx(tempData).select('*'));

      // Generate dynamic columns for PIVOT
      const columnsResult = await trx
        .select('judul')
        .from(tempData)
        .groupBy('judul');
      // console.log('columnsResult', columnsResult);

      let columns = '';
      columnsResult.forEach((row, index) => {
        if (index === 0) {
          columns = `[${row.judul}]`;
        } else {
          columns += `, [${row.judul}]`;
        }
      });
      // console.log('columns',columns);

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
              "JSON_VALUE(A.[trado luar], '$.statuspendukung_id') as tradoluar",
            ),
            trx.raw(
              "JSON_VALUE(A.[trado luar], '$.statuspendukung') as tradoluar_nama",
            ),
            trx.raw(
              "JSON_QUERY(A.[trado luar], '$.statuspendukung_memo') as tradoluar_memo",
            ),
            trx.raw(
              "JSON_VALUE(A.[pisah bl], '$.statuspendukung_id') as pisahbl",
            ),
            trx.raw(
              "JSON_VALUE(A.[pisah bl], '$.statuspendukung') as pisahbl_nama",
            ),
            trx.raw(
              "JSON_QUERY(A.[pisah bl], '$.statuspendukung_memo') as pisahbl_memo",
            ),
            trx.raw(
              "JSON_VALUE(A.[job ptd], '$.statuspendukung_id') as jobptd",
            ),
            trx.raw(
              "JSON_VALUE(A.[job ptd], '$.statuspendukung') as jobptd_nama",
            ),
            trx.raw(
              "JSON_QUERY(A.[job ptd], '$.statuspendukung_memo') as jobptd_memo",
            ),
            trx.raw(
              "JSON_VALUE(A.[transit], '$.statuspendukung_id') as transit",
            ),
            trx.raw(
              "JSON_VALUE(A.[transit], '$.statuspendukung') as transit_nama",
            ),
            trx.raw(
              "JSON_QUERY(A.[transit], '$.statuspendukung_memo') as transit_memo",
            ),
            trx.raw(
              "JSON_VALUE(A.[stuffing depo], '$.statuspendukung_id') as stuffingdepo",
            ),
            trx.raw(
              "JSON_VALUE(A.[stuffing depo], '$.statuspendukung') as stuffingdepo_nama",
            ),
            trx.raw(
              "JSON_QUERY(A.[stuffing depo], '$.statuspendukung_memo') as stuffingdepo_memo",
            ),
            trx.raw(
              "JSON_VALUE(A.[open door], '$.statuspendukung_id') as opendoor",
            ),
            trx.raw(
              "JSON_VALUE(A.[open door], '$.statuspendukung') as opendoor_nama",
            ),
            trx.raw(
              "JSON_QUERY(A.[open door], '$.statuspendukung_memo') as opendoor_memo",
            ),
            trx.raw(
              "JSON_VALUE(A.[batal muat], '$.statuspendukung_id') as batalmuat",
            ),
            trx.raw(
              "JSON_VALUE(A.[batal muat], '$.statuspendukung') as batalmuat_nama",
            ),
            trx.raw(
              "JSON_QUERY(A.[batal muat], '$.statuspendukung_memo') as batalmuat_memo",
            ),
            trx.raw("JSON_VALUE(A.[soc], '$.statuspendukung_id') as soc"),
            trx.raw("JSON_VALUE(A.[soc], '$.statuspendukung') as soc_nama"),
            trx.raw(
              "JSON_QUERY(A.[soc], '$.statuspendukung_memo') as soc_memo",
            ),
            trx.raw(
              "JSON_VALUE(A.[pengurusan door ekspedisi lain], '$.statuspendukung_id') as pengurusandoor",
            ),
            trx.raw(
              "JSON_VALUE(A.[pengurusan door ekspedisi lain], '$.statuspendukung') as pengurusandoor_nama",
            ),
            trx.raw(
              "JSON_QUERY(A.[pengurusan door ekspedisi lain], '$.statuspendukung_memo') as pengurusandoor_memo",
            ),
            trx.raw(
              "JSON_VALUE(A.[approval transaksi], '$.statuspendukung_id') as approval",
            ),
            trx.raw(
              "JSON_VALUE(A.[approval transaksi], '$.statuspendukung') as approval_nama",
            ),
            trx.raw(
              "JSON_QUERY(A.[approval transaksi], '$.statuspendukung_memo') as approval_memo",
            ),
          ])
          .from(trx.raw(pivotSubqueryRaw)),
      );
      // console.log('hasil', await trx(tempHasil).select('*'));

      return tempHasil;
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      const getIdOrderanMuatan = await trx
        .from(trx.raw(`${this.tableName}`))
        .select('id')
        .where('bookingorderan_id', id)
        .first();
      const existingData = await trx(this.tableName)
        .where('id', getIdOrderanMuatan.id)
        .first();
      const {
        container_nama,
        shipper_nama,
        tujuankapal_nama,
        marketing_nama,
        schedule_nama,
        pelayarancontainer_nama,
        jenismuatan_nama,
        sandarkapal_nama,
        tradoluar,
        tradoluar_nama,
        lokasistuffing_nama,
        emkllain_nama,
        daftarbl_nama,
        pisahbl,
        pisahbl_nama,
        jobptd,
        jobptd_nama,
        transit,
        transit_nama,
        stuffingdepo,
        stuffingdepo_nama,
        opendoor,
        opendoor_nama,
        batalmuat,
        batalmuat_nama,
        soc,
        soc_nama,
        pengurusandoorekspedisilain,
        pengurusandoorekspedisilain_nama,
        ...bookingOrderanData
      } = data;

      Object.keys(bookingOrderanData).forEach((key) => {
        if (typeof bookingOrderanData[key] === 'string') {
          bookingOrderanData[key] = bookingOrderanData[key].toUpperCase();
        }
      });

      const hasChanges = this.utilsService.hasChanges(
        bookingOrderanData,
        existingData,
      );
      if (hasChanges) {
        bookingOrderanData.updated_at = this.utilsService.getTime();
        await trx(this.tableName)
          .where('id', getIdOrderanMuatan.id)
          .update(bookingOrderanData);
      }

      // EDIT DATA PENDUKUNG BOOKING ORDERAN MUATAN
      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
      const getDataPendukungApproval = await trx('parameter')
        .select(
          trx.raw(`JSON_VALUE(${memoExpr}, '$."NILAI TIDAK"') AS nilai_tidak`),
        )
        .where('grp', 'DATA PENDUKUNG')
        .where('subgrp', this.tableName)
        .where('text', 'APPROVAL TRANSAKSI')
        .first();
      const dataPendukungMuatan = {
        'TRADO LUAR': tradoluar,
        'PISAH BL': pisahbl,
        'JOB PTD': jobptd,
        TRANSIT: transit,
        'STUFFING DEPO': stuffingdepo,
        'OPEN DOOR': opendoor,
        'BATAL MUAT': batalmuat,
        SOC: soc,
        'PENGURUSAN DOOR EKSPEDISI LAIN': pengurusandoorekspedisilain,
        'APPROVAL TRANSAKSI': getDataPendukungApproval.nilai_tidak,
      };

      const updateStatusPendukung = await this.statuspendukungService.update(
        this.tableName,
        getIdOrderanMuatan.id,
        bookingOrderanData.modifiedby,
        trx,
        dataPendukungMuatan,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT BOOKING ORDERAN MUATAN',
          idtrans: getIdOrderanMuatan.id,
          nobuktitrans: getIdOrderanMuatan.id,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      return {
        id: getIdOrderanMuatan.id,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      console.error('Error updating booking orderan header:', error);
      throw new Error('Failed to update booking orderan header');
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

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE BOOKING ORDERAN MUATAN',
          idtransss: id,
          nobuktitrans: id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby,
        },
        trx,
      );

      const statusPendukung = await trx
        .from(trx.raw(`statuspendukung`))
        .where('transaksi_id', deletedData.id);
      if (statusPendukung.length > 0) {
        await this.statuspendukungService.remove(
          deletedData.id,
          modifiedby,
          trx,
        );
      }

      return {
        status: 200,
        message: 'Data deleted successfully',
        id: deletedData.id,
        headerId: deletedData.bookingorderan_id,
      };
    } catch (error) {
      console.error('Error deleting data booking orderan muatan: ', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete data booking orderan muatan',
      );
    }
  }

  async findOne(id: string, trx: any) {
    try {
      const query = trx
        .from(trx.raw(`${this.tableName} as u`))
        .select([
          'u.id as id',
          'u.bookingorderan_id',
          'u.nobukti',
          'u.container_id',
          'u.shipper_id',
          'u.tujuankapal_id',
          'u.marketing_id',
          'u.keterangan',
          'u.schedule_id',
          'u.pelayarancontainer_id',
          'u.jenismuatan_id',
          'u.sandarkapal_id',
          'u.nopolisi',
          'u.nosp',
          'u.nocontainer',
          'u.noseal',
          'u.lokasistuffing',
          'u.nominalstuffing',
          'u.emkllain_id',
          'u.asalmuatan',
          'u.daftarbl_id',
          'u.comodity',
          'u.gandengan',
          'u.modifiedby',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),

          'header.id as header_id',
          'header.nobukti as header_nobukti',
          trx.raw("TO_CHAR(header.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'header.jenisorder_id',
          'jenisorderan.nama as jenisorder_nama',
          'header.statusformat',

          'container.nama as container_nama',
          'shipper.nama as shipper_nama',
          'tujuankapal.nama as tujuankapal_nama',
          'marketing.nama as marketing_nama',
          'schedulekapal.voyberangkat as schedule_nama',
          'pelayaran.nama as pelayarancontainer_nama',
          'jenismuatan.nama as jenismuatan_nama',
          'sandarkapal.nama as sandarkapal_nama',
          'hargatrucking.keterangan as lokasistuffing_nama',
          'emkl.nama as emkllain_nama',
          'daftarbl.nama as daftarbl_nama',
        ])
        .leftJoin(
          'bookingorderanheader as header',
          'u.nobukti',
          'header.nobukti',
        )
        .leftJoin('jenisorder as jenisorderan', 'header.jenisorder_id', 'jenisorderan.id')
        .leftJoin('container', 'u.container_id', 'container.id')
        .leftJoin('shipper', 'u.shipper_id', 'shipper.id')
        .leftJoin('tujuankapal', 'u.tujuankapal_id', 'tujuankapal.id')
        .leftJoin('marketing', 'u.marketing_id', 'marketing.id')
        .leftJoin('schedulekapal', 'u.schedule_id', 'schedulekapal.id')
        .leftJoin('pelayaran', 'u.pelayarancontainer_id', 'pelayaran.id')
        .leftJoin('jenismuatan', 'u.jenismuatan_id', 'jenismuatan.id')
        .leftJoin('sandarkapal', 'u.sandarkapal_id', 'sandarkapal.id')
        .leftJoin('hargatrucking', 'u.lokasistuffing', 'hargatrucking.id')
        .leftJoin('emkl', 'u.emkllain_id', 'emkl.id')
        .leftJoin('daftarbl', 'u.daftarbl_id', 'daftarbl.id')
        .where('u.id', id);

      const data = await query;
      console.log('data', data);

      return {
        data: data,
      };
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async checkValidasi(aksi: string, value: any, editedby: any, trx: any) {
    try {
      if (aksi === 'EDIT') {
        const getIdHeader = await trx(this.tableName)
          .select('bookingorderan_id')
          .where('id', value)
          .first();
        const cekOrderanNoBukti = await trx('bookingorderanheader')
          .select('orderan_nobukti')
          .where('id', getIdHeader.bookingorderan_id)
          .first();

        if (
          cekOrderanNoBukti?.orderan_nobukti &&
          cekOrderanNoBukti?.orderan_nobukti !== null
        ) {
          const validasi = await this.globalService.checkUsed(
            'orderanheader',
            'nobukti',
            cekOrderanNoBukti.orderan_nobukti,
            trx,
          );

          if (validasi.status === 'failed') {
            return {
              status: 'failed',
              message: `Data ini tidak diizinkan untuk diedit, silahkan edit dari orderan.`,
            };
          }
          return validasi;
        } else {
          const forceEdit = await this.locksService.forceEdit(
            this.tableName,
            value,
            editedby,
            trx,
          );
          return forceEdit;
        }
      } else if (aksi === 'DELETE') {
        const getIdHeader = await trx(this.tableName)
          .select('bookingorderan_id')
          .where('id', value)
          .first();
        const cekOrderanNoBukti = await trx('bookingorderanheader')
          .select('orderan_nobukti')
          .where('id', getIdHeader.bookingorderan_id)
          .first();

        const validasi = await this.globalService.checkUsed(
          'orderanheader',
          'nobukti',
          cekOrderanNoBukti.orderan_nobukti,
          trx,
        );
        return validasi;
      }
    } catch (error) {
      console.error('Error di checkValidasi:', error);
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      console.error('Error di checkValidasi booking orderan muatan:', error);
      throw new Error('Error di checkValidasi booking orderan muatan');
    }
  }
}
