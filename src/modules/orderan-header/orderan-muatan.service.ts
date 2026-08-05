import {
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { UpdateOrderanHeaderDto } from './dto/update-orderan-header.dto';
import {
  withUuidV7,
  formatDateToSQL,
  UtilsService,
} from 'src/utils/utils.service';
import {
  withUuidV7,
  formatDateToSQL,
  UtilsService,
} from 'src/utils/utils.service';
import { LocksService } from '../locks/locks.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { StatuspendukungService } from '../statuspendukung/statuspendukung.service';

@Injectable()
export class OrderanMuatanService {
  private readonly tableName: string = 'orderanmuatan';
  private readonly bookingMuatanTableName: string = 'bookingorderanmuatan';

  constructor(
    // @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly logTrailService: LogtrailService,
    private readonly statuspendukungService: StatuspendukungService,
  ) {}

  async create(data: any, trx: any) {
    try {
      const { booking_id, ...orderanData } = data;

      const getBooking = await trx
        .from(trx.raw(`${this.bookingMuatanTableName}`))
        .select([
          'container_id',
          'shipper_id',
          'tujuankapal_id',
          'marketing_id',
          'keterangan',
          'schedule_id',
          'pelayarancontainer_id',
          'jenismuatan_id',
          'sandarkapal_id',
          'nopolisi',
          'nosp',
          'nocontainer',
          'noseal',
          'lokasistuffing',
          'nominalstuffing',
          // bookingorderanmuatan.emkl_id -> orderanmuatan.emkl_id (hasil
          // select ini di-spread langsung ke insert), jadi TIDAK boleh
          // di-alias ke emkl_id di sini.
          'emkl_id',
          'asalmuatan',
          'daftarbl_id',
          'comodity',
          'gandengan',
        ])
        .where('id', booking_id)
        .first();

      const mergedData = {
        ...orderanData,
        ...getBooking,
      };

      const insertedData = await trx(this.tableName)
        .insert(await withUuidV7(trx, mergedData))
        .returning('*');
      const newItem = insertedData[0];

      // get status pendukung dari booking orderan muatan
      const getStatusPendukungBookingData = await trx('statuspendukung')
        .select('statuspendukung')
        .where('transaksi_id', booking_id);
      const values = getStatusPendukungBookingData.map(
        (v) => v.statuspendukung,
      ); //jadikan hasil query ke bentuk array
      const keys = [
        'TRADO LUAR',
        'PISAH BL',
        'JOB PTD',
        'TRANSIT',
        'STUFFING DEPO',
        'OPEN DOOR',
        'BATAL MUAT',
        'SOC',
        'PENGURUSAN DOOR EKSPEDISI LAIN',
        'APPROVAL TRANSAKSI',
      ];

      const dataPendukungOrderanMuatan = keys.reduce((obj, key, i) => {
        obj[key] = values[i] ?? null; // isi sesuai urutan, kalau data habis → null
        return obj;
      }, {});

      const insertStatusPendukungOrderanMuatan =
        await this.statuspendukungService.create(
          this.tableName,
          newItem.id,
          newItem.modifiedby,
          trx,
          dataPendukungOrderanMuatan,
        );

      await this.logTrailService.create(
        {
          namatable: this.tableName,
          postingdari: 'ADD ORDERAN MUATAN',
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
      // throw new Error(
      //   `Error creating orderan muatan in service: ${error.message}`,
      // );
      console.error(
        'Error process approval creating orderan muatan in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process approval creating orderan muatan in service',
      );
    }
  }

  async findAll(
    { search, filters, pagination, sort, isLookUp, exactMatch }: FindAllParams,
    trx: any,
    notIn?: any,
  ) {
    try {
      let { page, limit } = pagination ?? {};
      page = page ?? 1;
      limit = limit ?? 0;

      if (isLookUp) {
        const totalData = await trx(this.tableName)
          .count('id as total')
          .first();
        const resultTotalData = totalData?.total || 0;

        if (Number(resultTotalData) > 500) {
          return {
            data: {
              type: 'json',
            },
          };
        } else {
          limit = 0;
        }
      }

      const fieldTempHasil = [
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

      // const dataTempStatusPendukung = await this.tempStatusPendukung(
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
          'u.orderan_id',
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
          // Kolom fisiknya bernama emkl_id (lihat migration orderanmuatan),
          // tapi FE/DTO memakai nama emkl_id -> alias, jangan diubah
          // nama outputnya.
          'u.emkl_id as emkl_id',
          'u.asalmuatan',
          'u.daftarbl_id',
          'u.comodity',
          'u.gandengan',
          'u.modifiedby',
          trx.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
          trx.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),

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
        .leftJoin('orderanheader as header', 'u.nobukti', 'header.nobukti')
        .leftJoin(
          'jenisorder as jenisorderan',
          'header.jenisorder_id',
          'jenisorderan.id',
        )
        .leftJoin(
          'jenisorder as jenisorderan',
          'header.jenisorder_id',
          'jenisorderan.id',
        )
        .leftJoin('container', 'u.container_id', 'container.id')
        .leftJoin('shipper', 'u.shipper_id', 'shipper.id')
        .leftJoin('tujuankapal', 'u.tujuankapal_id', 'tujuankapal.id')
        .leftJoin('marketing', 'u.marketing_id', 'marketing.id')
        .leftJoin('schedulekapal', 'u.schedule_id', 'schedulekapal.id')
        .leftJoin('pelayaran', 'u.pelayarancontainer_id', 'pelayaran.id')

        .leftJoin('jenismuatan', 'u.jenismuatan_id', 'jenismuatan.id')
        .leftJoin('sandarkapal', 'u.sandarkapal_id', 'sandarkapal.id')
        // u.lokasistuffing bertipe bigint, hargatrucking.id bertipe varchar —
        // cast eksplisit ke text supaya join tidak error "operator does not
        // exist: bigint = text". Ini bug lama yang selama ini tersamar
        // karena query ini selalu gagal duluan di step PIVOT (MSSQL) sebelum
        // pernah sampai mengeksekusi join ini.
        .leftJoin(
          'hargatrucking',
          trx.raw('u.lokasistuffing::text'),
          'hargatrucking.id',
        )
        .leftJoin('emkl', 'u.emkl_id', 'emkl.id')
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

      if (exactMatch) {
        query.where('u.nobukti', '=', exactMatch);
      }

      const excludeSearchKeys = ['tglDari', 'tglSampai'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );
      console.log('searchFields', searchFields);
      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            qb.orWhere(`u.${field}`, 'like', `%${sanitized}%`);
          });
        });
      }

      if (notIn) {
        // Jika notIn adalah string JSON, parse dulu
        const notInObj = typeof notIn === 'string' ? JSON.parse(notIn) : notIn;

        if (notInObj && typeof notInObj === 'object') {
          // Loop semua key di notIn object
          for (const [key, values] of Object.entries(notInObj)) {
            if (Array.isArray(values) && values.length > 0) {
              query.whereNotIn(`u.${key}`, values);
            }
          }
        }
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
            console.log('MASUK SINI4');

            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw(
                "TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?",
                [key, `%${sanitizedValue}%`],
              );
              query.andWhereRaw(
                "TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?",
                [key, `%${sanitizedValue}%`],
              );
            } else if (key === 'tglbukti') {
              query.andWhereRaw("TO_CHAR(header.??, 'DD-MM-YYYY') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
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
            } else if (key === 'schedule_id') {
              query.andWhere('schedulekapal.id', '=', sanitizedValue);
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
            } else if (key === 'daftarbl_id') {
              query.andWhere('daftarbl.id', '=', sanitizedValue);
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
      console.error('Error to findAll Orderan Muatan', error);
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

      return tempHasil;
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} orderanHeader`;
  }

  async update(nobukti: string, data: any, trx: any) {
    try {
      let updatedData;
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
        ...orderanData
      } = data;

      Object.keys(orderanData).forEach((key) => {
        if (typeof orderanData[key] === 'string') {
          orderanData[key] = orderanData[key].toUpperCase();
        }
      });

      const existingData = await trx(this.tableName)
        .where('nobukti', nobukti)
        .first();
      if (!existingData) {
        throw new Error(`Orderan dengan nobukti ${nobukti} tidak ditemukan`);
      }
      const hasChanges = this.utilsService.hasChanges(
        orderanData,
        existingData,
      );
      const getIdBookingHeader = await trx('bookingorderanheader')
        .select('id')
        .where('orderan_nobukti', nobukti)
        .first();
      const existingDataBooking = await trx(this.bookingMuatanTableName).where(
        'bookingorderan_id',
        getIdBookingHeader.id,
      );
      const hasChangesBooking = this.utilsService.hasChanges(
        orderanData,
        existingDataBooking,
      );
      const getApprovalNilaiYa = await trx('parameter')
        .where('grp', 'STATUS APPROVAL')
        .where('text', 'APPROVAL')
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
        'APPROVAL TRANSAKSI': getApprovalNilaiYa.id,
      };

      if (hasChanges) {
        orderanData.updated_at = this.utilsService.getTime();
        updatedData = await trx(this.tableName)
          .where('nobukti', nobukti)
          .update(orderanData)
          .returning('*');

        await this.logTrailService.create(
          {
            namatabel: this.tableName,
            postingdari: 'EDIT ORDERAN MUATAN',
            idtrans: updatedData[0].id,
            nobuktitrans: updatedData[0].id,
            aksi: 'EDIT',
            datajson: JSON.stringify(data),
            modifiedby: data.modifiedby,
          },
          trx,
        );

        // UPDATE DATA PENDUKUNG ORDERAN MUATAN
        await this.statuspendukungService.update(
          this.tableName,
          updatedData[0].id,
          updatedData[0].modifiedby,
          trx,
          dataPendukungMuatan,
        );
      }

      if (hasChangesBooking) {
        orderanData.updated_at = this.utilsService.getTime();
        const updatedBooking = await trx(this.bookingMuatanTableName)
          .where('bookingorderan_id', getIdBookingHeader.id)
          .update(orderanData)
          .returning('*');

        await this.logTrailService.create(
          {
            namatabel: this.tableName,
            postingdari: 'EDIT BOOKING ORDERAN MUATAN',
            idtrans: updatedBooking[0].id,
            nobuktitrans: updatedBooking[0].id,
            aksi: 'EDIT',
            datajson: JSON.stringify(data),
            modifiedby: data.modifiedby,
          },
          trx,
        );

        // UPDATE DATA PENDUKUNG BOOKING ORDERAN MUATAN
        await this.statuspendukungService.update(
          this.bookingMuatanTableName,
          updatedBooking[0].id,
          updatedBooking[0].modifiedby,
          trx,
          dataPendukungMuatan,
        );
      }

      return {
        id: updatedData[0].id,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      console.error('Error updating orderan header:', error);
      throw new Error('Failed to update orderan header');
    }
  }

  async delete(nobukti: string, trx: any) {
    try {
      const deletedData = await this.utilsService.lockAndDestroy(
        nobukti,
        this.tableName,
        'nobukti',
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE ORDERAN MUATAN',
          idtrans: deletedData.id,
          nobuktitrans: deletedData.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: deletedData.modifiedby,
        },
        trx,
      );

      const statusPendukung = await trx
        .from(trx.raw(`statuspendukung`))
        .where('transaksi_id', deletedData.id);

      if (statusPendukung.length > 0) {
        await this.statuspendukungService.remove(
          deletedData.id,
          deletedData.modifiedby,
          trx,
        );
      }

      return {
        status: 200,
        message: 'Data deleted successfully',
        id: deletedData.id,
        headerId: deletedData.orderan_id,
      };
    } catch (error) {
      console.error(
        'Error process approval Error delete orderan muatan in service in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process approval delete orderan muatan in service in service',
      );
    }
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
        return {
          status: 'success',
          message: 'Data aman untuk dihapus.',
        };
      }
    } catch (error) {
      console.error('Error di checkValidasi:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }

  /**
   * PROSES SHIPPING — satu query GROUP BY, tidak menulis apa pun.
   *
   * Dikelompokkan per `daftarbl_id` (satu grup = satu baris DETAIL shipping
   * instruction), dan tiap grup membawa daftar orderan muatannya sebagai
   * `detailsrincian` lewat json_agg — jadi tidak perlu lagi N+1 request ke
   * /orderanheader untuk mengambil rincian tiap grup seperti sebelumnya.
   *
   * Kolom detail yang bisa diturunkan dari orderanmuatan hanya:
   *   asalpelabuhan <- u.asalmuatan
   *   shipper       <- shipper.nama (lewat u.shipper_id)
   *   comodity      <- default parameter (GENERAL CARGO)
   * `consignee`, `notifyparty`, dan `totalgw` TIDAK punya kolom sumber di
   * orderanmuatan maupun daftarbl, jadi tidak diisi di sini — lihat catatan di
   * form: ketiganya tetap bisa diisi user dan dipertahankan saat proses ulang.
   *
   * MAX(...) dipakai untuk kolom non-group supaya tetap valid di GROUP BY;
   * dalam satu daftarbl nilainya memang seragam.
   */
  async processShipping(schedule_id: any, trx: any) {
  /**
   * PROSES SHIPPING — satu query GROUP BY, tidak menulis apa pun.
   *
   * Dikelompokkan per `daftarbl_id` (satu grup = satu baris DETAIL shipping
   * instruction), dan tiap grup membawa daftar orderan muatannya sebagai
   * `detailsrincian` lewat json_agg — jadi tidak perlu lagi N+1 request ke
   * /orderanheader untuk mengambil rincian tiap grup seperti sebelumnya.
   *
   * Kolom detail yang bisa diturunkan dari orderanmuatan hanya:
   *   asalpelabuhan <- u.asalmuatan
   *   shipper       <- shipper.nama (lewat u.shipper_id)
   *   comodity      <- default parameter (GENERAL CARGO)
   * `consignee`, `notifyparty`, dan `totalgw` TIDAK punya kolom sumber di
   * orderanmuatan maupun daftarbl, jadi tidak diisi di sini — lihat catatan di
   * form: ketiganya tetap bisa diisi user dan dipertahankan saat proses ulang.
   *
   * MAX(...) dipakai untuk kolom non-group supaya tetap valid di GROUP BY;
   * dalam satu daftarbl nilainya memang seragam.
   */
  async processShipping(schedule_id: any, trx: any) {
    try {
      // Default comodity diambil dari parameter supaya bisa diubah tanpa deploy.
      // Kalau barisnya belum ada, jatuh ke 'GENERAL CARGO'.
      const defaultComodityRow = await trx('parameter')
        .select('text')
        .where('grp', 'COMODITY DEFAULT')
        .andWhere('subgrp', 'SHIPPING INSTRUCTION')
        .first();

      const defaultComodity = defaultComodityRow?.text || 'GENERAL CARGO';

      // Default comodity diambil dari parameter supaya bisa diubah tanpa deploy.
      // Kalau barisnya belum ada, jatuh ke 'GENERAL CARGO'.
      const defaultComodityRow = await trx('parameter')
        .select('text')
        .where('grp', 'COMODITY DEFAULT')
        .andWhere('subgrp', 'SHIPPING INSTRUCTION')
        .first();

      const defaultComodity = defaultComodityRow?.text || 'GENERAL CARGO';

      const query = trx
        .from(trx.raw(`${this.tableName} as u`))
        .leftJoin('shipper as s', 'u.shipper_id', 's.id')
        .leftJoin('shipper as s', 'u.shipper_id', 's.id')
        .select([
          'u.daftarbl_id',
          trx.raw('MAX(u.emkl_id) AS emkl_id'),
          trx.raw('MAX(u.emkl_id) AS emkl_id'),
          trx.raw('MAX(u.pelayarancontainer_id) AS pelayarancontainer_id'),
          trx.raw('MAX(u.tujuankapal_id) AS tujuankapal_id'),
          trx.raw('MAX(u.id) AS orderan_id'),
          trx.raw('MAX(u.asalmuatan) AS asalpelabuhan'),
          trx.raw('MAX(s.nama) AS shipper'),
          trx.raw('?::text AS comodity', [defaultComodity]),
          // SEMENTARA dipatok. `consignee` belum punya kolom sumber di
          // orderanmuatan maupun daftarbl, tapi di form dibuat read-only, jadi
          // nilainya harus datang dari sini. Begitu sumber aslinya ada, ganti
          // literal ini dengan kolomnya (atau ikuti pola parameter seperti
          // COMODITY DEFAULT di atas).
          trx.raw(`?::text AS consignee`, ['PT TAS']),
          // Satu baris rincian per orderan muatan di grup ini.
          trx.raw(
            `json_agg(
               json_build_object(
                 'orderanmuatan_nobukti', COALESCE(u.nobukti, ''),
                 'comodity', ?::text,
                 'nocontainer', COALESCE(u.nocontainer, ''),
                 'noseal', COALESCE(u.noseal, ''),
                 'shipper_id', u.shipper_id,
                 'shipper_nama', COALESCE(s.nama, '')
               )
               ORDER BY u.nobukti
             ) AS detailsrincian`,
            [defaultComodity],
          ),
          trx.raw('MAX(u.asalmuatan) AS asalpelabuhan'),
          trx.raw('MAX(s.nama) AS shipper'),
          trx.raw('?::text AS comodity', [defaultComodity]),
          // SEMENTARA dipatok. `consignee` belum punya kolom sumber di
          // orderanmuatan maupun daftarbl, tapi di form dibuat read-only, jadi
          // nilainya harus datang dari sini. Begitu sumber aslinya ada, ganti
          // literal ini dengan kolomnya (atau ikuti pola parameter seperti
          // COMODITY DEFAULT di atas).
          trx.raw(`?::text AS consignee`, ['PT TAS']),
          // Satu baris rincian per orderan muatan di grup ini.
          trx.raw(
            `json_agg(
               json_build_object(
                 'orderanmuatan_nobukti', COALESCE(u.nobukti, ''),
                 'comodity', ?::text,
                 'nocontainer', COALESCE(u.nocontainer, ''),
                 'noseal', COALESCE(u.noseal, ''),
                 'shipper_id', u.shipper_id,
                 'shipper_nama', COALESCE(s.nama, '')
               )
               ORDER BY u.nobukti
             ) AS detailsrincian`,
            [defaultComodity],
          ),
        ])
        .where('u.schedule_id', schedule_id)
        .groupBy('u.daftarbl_id');

      const data = await query;

      return {
        data,
      };
    } catch (error) {
      console.error('Error to processShipping Orderan Muatan', error);
      console.error('Error to processShipping Orderan Muatan', error);
      throw new Error(error);
    }
  }
}
