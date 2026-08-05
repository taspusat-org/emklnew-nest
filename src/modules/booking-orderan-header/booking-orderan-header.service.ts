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
  UtilsService,
} from 'src/utils/utils.service';
import { GlobalService } from '../global/global.service';
import { RedisService } from 'src/common/redis/redis.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { dbMssql } from 'src/common/utils/db';
import { BookingOrderanMuatanService } from './bookingorderanmuatan.service';

@Injectable()
export class BookingOrderanHeaderService {
  private readonly tableName: string = 'bookingorderanheader';

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly bookingOrderanMuatanService: BookingOrderanMuatanService,
  ) { }
  ) { }

  async create(createData: any, trx: any) {
    try {
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        method,
        nobukti,
        tglbukti,
        jenisorder_id,
        jenisorder_nama,
        party,
        details,
        ...bookingOrderanData
      } = createData;

      let bookingOrderanId;
      let serviceCreate;
      let serviceFindAll;
      const insertedHeaders: any[] = [];
      const nomorBuktiList: string[] = [];
      const headerData = {
        nobukti,
        tglbukti,
        jenisorder_id,
        statusformat: 0,
        modifiedby: createData.modifiedby,
        updated_at: '',
        created_at: '',
      };
      const getJenisOrderanMuatan = await trx
        .from(trx.raw(`parameter`))
        .select('id')
        .where('grp', 'JENIS ORDERAN')
        .where('subgrp', 'MUATAN')
        .first();
      const getJenisOrderanBongkaran = await trx
        .from(trx.raw(`parameter`))
        .select('id')
        .where('grp', 'JENIS ORDERAN')
        .where('subgrp', 'BONGKARAN')
        .first();
      const getJenisOrderanImport = await trx
        .from(trx.raw(`parameter`))
        .select('id')
        .where('grp', 'JENIS ORDERAN')
        .where('subgrp', 'IMPORT')
        .first();
      const getJenisOrderanExport = await trx
        .from(trx.raw(`parameter`))
        .select('id')
        .where('grp', 'JENIS ORDERAN')
        .where('subgrp', 'EXPORT')
        .first();

      const getIdJenisOrderan = await trx
        .from(trx.raw(`parameter`))
        .select('text')
        .where('id', jenisorder_id)
        .first();

      const getStatusFormatFromOrderan = await trx
        .from(trx.raw(`jenisorder`))
        .select('statusformat')
        .where('id', getIdJenisOrderan?.text)
        .first();

      const getFormatBookingOrderan = await trx
        .from(trx.raw(`parameter`))
        .select(['id', 'grp', 'subgrp', 'text'])
        .where('id', getStatusFormatFromOrderan.statusformat)
        .first();

      switch (jenisorder_id) {
        case getJenisOrderanMuatan?.id:
          serviceCreate = this.bookingOrderanMuatanService;
          serviceFindAll = this.bookingOrderanMuatanService;
          break;
        // case 'IMPORT':
        //   service = this.hitungmodalimportService;
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          // Default to MUATAN as per the original logic
          serviceCreate = this.bookingOrderanMuatanService;
          serviceFindAll = this.bookingOrderanMuatanService;
          break;
      }

      createData.tglbukti = formatDateToSQL(String(createData?.tglbukti));
      if (party && party != null) {
        for (let i = 1; i <= party; i++) {
          // 1. generate nomor bukti
          const nomorBukti =
            await this.runningNumberService.generateRunningNumber(
              trx,
              getFormatBookingOrderan.grp,
              getFormatBookingOrderan.subgrp,
              this.tableName,
              createData.tglbukti,
              null,
              createData.tujuankapal_id,
              null,
              createData.marketing_id,
            );
          nomorBuktiList.push(nomorBukti);

          // 2. susun headerData
          const headerData = {
            nobukti: nomorBukti,
            tglbukti: createData.tglbukti,
            jenisorder_id: getIdJenisOrderan.text,
            statusformat: getStatusFormatFromOrderan.statusformat,
            modifiedby: createData.modifiedby,
            updated_at: this.utilsService.getTime(),
            created_at: this.utilsService.getTime(),
          };

          // 3. uppercase / format date
          Object.keys(headerData).forEach((key) => {
            if (typeof headerData[key] === 'string') {
              const value = headerData[key];
              const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

              if (dateRegex.test(value)) {
                headerData[key] = formatDateToSQL(value);
              } else {
                headerData[key] = headerData[key].toUpperCase();
              }
            }
          });

          // 4. insert data header
          const insertedData = await trx(this.tableName)
            .insert(await withUuidV7(trx, headerData))
            .returning('*');

          const newHeader = insertedData[0];
          // 5. push hasil insert data header ke array
          insertedHeaders.push(newHeader);

          await this.logTrailService.create(
            {
              namatable: this.tableName,
              postingdari: 'ADD BOOKING ORDERAN HEADER',
              idtrans: newHeader.id,
              nobuktitrans: newHeader.id,
              aksi: 'ADD',
              datajson: JSON.stringify(newHeader),
              modifiedby: newHeader.modifiedby,
            },
            trx,
          );
        }

        const detailsWithNoBukti = details.map((detail, index) => ({
          ...detail,
          nobukti: nomorBuktiList[index] ?? null,
          bookingorderan_id: insertedHeaders[index].id ?? null,
          ...bookingOrderanData,
        }));

        for (const detail of detailsWithNoBukti) {
          // await serviceCreate.create(detail, trx);
          const insertBookingOrderan = await serviceCreate.create(detail, trx);
          bookingOrderanId = insertBookingOrderan.newItem.id;
        }
      } else {
        const nomorBukti =
          await this.runningNumberService.generateRunningNumber(
            trx,
            getFormatBookingOrderan.grp,
            getFormatBookingOrderan.subgrp,
            this.tableName,
            createData.tglbukti,
            null,
            createData.tujuankapal_id,
            null,
            createData.marketing_id,
          );

        headerData.nobukti = nomorBukti;
        headerData.jenisorder_id = getIdJenisOrderan.text;
        headerData.statusformat = getStatusFormatFromOrderan.statusformat;
        headerData.updated_at = this.utilsService.getTime();
        headerData.created_at = this.utilsService.getTime();

        Object.keys(headerData).forEach((key) => {
          if (typeof headerData[key] === 'string') {
            const value = headerData[key];
            const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

            if (dateRegex.test(value)) {
              headerData[key] = formatDateToSQL(value);
            } else {
              headerData[key] = headerData[key].toUpperCase();
            }
          }
        });
        console.log('nomorBukti', nomorBukti);

        const insertedData = await trx(this.tableName)
          .insert(await withUuidV7(trx, headerData))
          .returning('*');
        const newItem = insertedData[0];

        await this.logTrailService.create(
          {
            namatable: this.tableName,
            postingdari: 'ADD BOOKING ORDERAN HEADER',
            idtrans: newItem.id,
            nobuktitrans: newItem.id,
            aksi: 'ADD',
            datajson: JSON.stringify(newItem),
            modifiedby: newItem.modifiedby,
          },
          trx,
        );

        bookingOrderanData.bookingorderan_id = Number(newItem.id);
        bookingOrderanData.nobukti = newItem.nobukti;

        const insertBookingOrderan = await serviceCreate.create(
          bookingOrderanData,
          trx,
        );
        bookingOrderanId = insertBookingOrderan.newItem.id;
      }

      // const insertBookingOrderan = await serviceCreate.create(
      //   bookingOrderanData,
      //   trx,
      // );
      // const dataBookingOrderan = insertBookingOrderan.newItem

      // await this.logTrailService.create(
      //   {
      //     namatable: this.tableName,
      //     postingdari: 'ADD BOOKING ORDERAN HEADER',
      //     idtrans: newItem.id,
      //     nobuktitrans: newItem.id,
      //     aksi: 'ADD',
      //     datajson: JSON.stringify(newItem),
      //     modifiedby: newItem.modifiedby,
      //   },
      //   trx,
      // );

      const { data, pagination } = await serviceFindAll.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false,
        },
        trx,
      );
      console.log(sortBy, sortDirection, serviceFindAll, data);

      let dataIndex = data.findIndex((item) => item.id === bookingOrderanId);
      console.log('bookingOrderanId', bookingOrderanId, dataIndex);

      if (dataIndex === -1) {
        dataIndex = 0;
      }

      const pageNumber = pagination?.currentPage;
      console.log('dataIndex', dataIndex, 'pageNumber', pageNumber);

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(data),
      );

      return {
        // dataBookingOrderan,
        pageNumber,
        dataIndex,
      };
    } catch (error) {
      throw new Error(
        `Error creating booking orderan header: ${error.message}`,
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

      const query = trx
        .from(trx.raw(`${this.tableName} as u`))
        .select([
          'u.id as id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.jenisorder_id',
          'jenisorderan.nama as jenisorderan_nama',
          'u.statusformat',
          'u.modifiedby',
          trx.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
          'muatan.nobukti as nobukti_muatan',
          'container.nama as container_nama',
          'shipper.nama as shipper_nama',
          'tujuankapal.nama as tujuankapal_nama',
          'marketing.nama as marketing_nama',
          'muatan.keterangan as keterangan_muatan',
          'jenismuatan.nama as jenismuatan_nama',
          'sandarkapal.nama as sandarkapal_nama',
          'nopolisi as nopolisi_muatan',
          'nosp as nosp_muatan',
          'nocontainer as nocontainer_muatan',
          'noseal as noseal_muatan',
          'lokasistuffing as lokasistuffing_muatan',
          'nominalstuffing as nominalstuffing_muatan',
          // 'emkl.nama as emkllain_nama',
          'asalmuatan as asalmuatan_muatan',
          'daftarbl.nama as daftarbl_nama',
          'comodity as comodity_muatan',
          'gandengan as gandengan_muatan',
        ])
        .leftJoin(
          'bookingorderanmuatan as muatan',
          'u.nobukti',
          'muatan.nobukti',
        )
        .leftJoin(
          'jenisorder as jenisorderan',
          'u.jenisorder_id',
          'jenisorderan.id',
        )
        .leftJoin('container', 'u.container_id', 'container.id')
        .leftJoin('shipper', 'u.shipper_id', 'shipper.id')
        .leftJoin('tujuankapal', 'u.tujuankapal_id', 'tujuankapal.id')
        .leftJoin('marketing', 'u.marketing_id', 'marketing.id')
        // .leftJoin('schedule', 'u.schedule_id', 'schedule.id')
        // .leftJoin('pelayarancontainer', 'u.pelayarancontainer_id', 'pelayarancontainer.id')
        .leftJoin('jenismuatan', 'u.jenismuatan_id', 'jenismuatan.id')
        .leftJoin('sandarkapal', 'u.sandarkapal_id', 'sandarkapal.id')
        .leftJoin('emkl', 'u.emkl_id', 'emkl.id')
        .leftJoin('daftarbl', 'u.daftarbl_id', 'daftarbl.id');

      console.log('filters', filters, filters?.tglDari, filters?.tglSampai);

      if (filters?.tglDari && filters?.tglSampai) {
        const tglDariFormatted = formatDateToSQL(String(filters?.tglDari));
        const tglSampaiFormatted = formatDateToSQL(String(filters?.tglSampai));

        query.whereBetween('u.tglbukti', [
          tglDariFormatted,
          tglSampaiFormatted,
        ]);
      }

      if (search) {
        const sanitizedValue = String(search).replace(/\[/g, '[[]');
        query.where((builder) => {
          builder
            .orWhere('u.nobukti', 'like', `%${sanitizedValue}%`)
            .orWhereRaw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') LIKE ?", [
              `%${sanitizedValue}%`,
            ])
            .orWhere('bankdari.keterangan', 'like', `%${sanitizedValue}%`)
            .orWhere('bankke.keterangan', 'like', `%${sanitizedValue}%`)
            .orWhere('coadebet.keterangancoa', 'like', `%${sanitizedValue}%`)
            .orWhere('coakredit.keterangancoa', 'like', `%${sanitizedValue}%`)
            .orWhere('p.keterangan', 'like', `%${sanitizedValue}%`)
            .orWhere('u.nowarkat', 'like', `%${sanitizedValue}%`)
            .orWhereRaw("TO_CHAR(u.tgljatuhtempo, 'DD-MM-YYYY') LIKE ?", [
              `%${sanitizedValue}%`,
            ])
            .orWhere('u.keterangan', 'like', `%${sanitizedValue}%`)
            .orWhere('u.nominal', 'like', `%${sanitizedValue}%`)
            .orWhere('u.modifiedby', 'like', `%${sanitizedValue}%`)
            .orWhereRaw(
              "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') LIKE ?",
              [`%${sanitizedValue}%`],
            )
            .orWhereRaw(
              "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') LIKE ?",
              [`%${sanitizedValue}%`],
            );
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          if (key === 'tglDari' || key === 'tglSampai') {
            continue; // Lewati filter jika key adalah 'tglDari' atau 'tglSampai'
          }

          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw(
                "TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?",
                [key, `%${sanitizedValue}%`],
              );
            } else if (key === 'tglbukti' || key === 'tgljatuhtempo') {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'coadebet_text') {
              query.andWhere(
                'coadebet.keterangancoa',
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'coakredit_text') {
              query.andWhere(
                'coakredit.keterangancoa',
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'bankdari_text') {
              query.andWhere(
                'bankdari.keterangan',
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'bankke_text') {
              query.andWhere(
                'bankke.keterangan',
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'alatbayar_text') {
              query.andWhere('p.keterangan', 'like', `%${sanitizedValue}%`);
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
        if (sort?.sortBy === 'bankdari_text') {
          query.orderBy('bankdari.keterangan', sort.sortDirection);
        } else if (sort?.sortBy === 'bankke_text') {
          query.orderBy('bankke.keterangan', sort.sortDirection);
        } else if (sort?.sortBy === 'coadebet_text') {
          query.orderBy('coadebet.keterangancoa', sort.sortDirection);
        } else if (sort?.sortBy === 'coakredit_text') {
          query.orderBy('coakredit.keterangancoa', sort.sortDirection);
        } else if (sort?.sortBy === 'alatbayar_text') {
          query.orderBy('p.keterangan', sort.sortDirection);
        } else {
          query.orderBy(sort.sortBy, sort.sortDirection);
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
      console.error('Error to findAll Booking Orderan Header', error);
      throw new Error(error);
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      const existingData = await trx(this.tableName).where('id', id).first();

      if (!existingData) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Data Not Found!',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        method,
        nobukti,
        tglbukti,
        jenisorder_id,
        jenisorder_nama,
        ...bookingOrderanData
      } = data;

      let serviceCreate;
      let serviceFindAll;
      const headerData = {
        nobukti,
        tglbukti,
        jenisorder_id,
        statusformat: 0,
        modifiedby: data.modifiedby,
        updated_at: '',
        // created_at: '',
      };
      const getJenisOrderanMuatan = await trx
        .from(trx.raw(`parameter`))
        .select('id')
        .where('grp', 'JENIS ORDERAN')
        .where('subgrp', 'MUATAN')
        .first();
      const getJenisOrderanBongkaran = await trx
        .from(trx.raw(`parameter`))
        .select('id')
        .where('grp', 'JENIS ORDERAN')
        .where('subgrp', 'BONGKARAN')
        .first();
      const getJenisOrderanImport = await trx
        .from(trx.raw(`parameter`))
        .select('id')
        .where('grp', 'JENIS ORDERAN')
        .where('subgrp', 'IMPORT')
        .first();
      const getJenisOrderanExport = await trx
        .from(trx.raw(`parameter`))
        .select('id')
        .where('grp', 'JENIS ORDERAN')
        .where('subgrp', 'EXPORT')
        .first();

      const getIdJenisOrderan = await trx
        .from(trx.raw(`parameter`))
        .select('text')
        .where('id', jenisorder_id)
        .first();

      const getStatusFormatFromOrderan = await trx
        .from(trx.raw(`jenisorder`))
        .select('statusformat')
        .where('id', getIdJenisOrderan?.text)
        .first();

      headerData.jenisorder_id = getIdJenisOrderan.text;
      headerData.statusformat = getStatusFormatFromOrderan.statusformat;
      bookingOrderanData.nobukti = nobukti;
      bookingOrderanData.bookingorderan_id = id;

      Object.keys(headerData).forEach((key) => {
        if (typeof headerData[key] === 'string') {
          const value = headerData[key];
          const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

          if (dateRegex.test(value)) {
            headerData[key] = formatDateToSQL(value);
          } else {
            headerData[key] = headerData[key].toUpperCase();
          }
        }
      });

      const hasChanges = this.utilsService.hasChanges(headerData, existingData);

      if (hasChanges) {
        headerData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(headerData);
      }

      switch (jenisorder_id) {
        case getJenisOrderanMuatan?.id:
          serviceCreate = this.bookingOrderanMuatanService;
          serviceFindAll = this.bookingOrderanMuatanService;
          break;
        // case 'IMPORT':
        //   service = this.hitungmodalimportService;
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          serviceCreate = this.bookingOrderanMuatanService;
          serviceFindAll = this.bookingOrderanMuatanService;
          break;
      }

      const updateBookingOrderan = await serviceCreate.update(
        id,
        bookingOrderanData,
        trx,
      );
      const idBookingOrderan = updateBookingOrderan.id;

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT BOOKING ORDERAN HEADER',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      const { data: filteredData, pagination } = await serviceFindAll.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false,
        },
        trx,
      );

      let dataIndex = filteredData.findIndex(
        (item) => String(item.id) === String(updateBookingOrderan.id),
      );
      if (dataIndex === -1) {
        dataIndex = 0;
      }

      const itemsPerPage = limit || 30;
      const pageNumber = Math.floor(dataIndex / itemsPerPage) + 1;
      const endIndex = pageNumber * itemsPerPage;
      const limitedItems = filteredData.slice(0, endIndex);

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      return {
        newItems: {
          idBookingOrderan,
          ...data,
        },
        pageNumber,
        dataIndex,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      console.error('Error updating booking orderan header:', error);
      throw new Error('Failed to update booking orderan header');
    }
  }

  async delete(id: string, trx: any, modifiedby: string, data: any) {
    try {
      let deleteService;
      const getJenisOrderanMuatan = await trx
        .from(trx.raw(`parameter`))
        .select('id')
        .where('grp', 'JENIS ORDERAN')
        .where('subgrp', 'MUATAN')
        .first();
      const getJenisOrderanBongkaran = await trx
        .from(trx.raw(`parameter`))
        .select('id')
        .where('grp', 'JENIS ORDERAN')
        .where('subgrp', 'BONGKARAN')
        .first();
      const getJenisOrderanImport = await trx
        .from(trx.raw(`parameter`))
        .select('id')
        .where('grp', 'JENIS ORDERAN')
        .where('subgrp', 'IMPORT')
        .first();
      const getJenisOrderanExport = await trx
        .from(trx.raw(`parameter`))
        .select('id')
        .where('grp', 'JENIS ORDERAN')
        .where('subgrp', 'EXPORT')
        .first();

      switch (data.jenisOrderan) {
        case getJenisOrderanMuatan?.id:
          deleteService = this.bookingOrderanMuatanService;
          break;
        // case 'IMPORT':
        //   service = this.hitungmodalimportService;
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          deleteService = this.bookingOrderanMuatanService;
          break;
      }

      const result = await deleteService.delete(+id, trx, modifiedby);

      const deletedData = await this.utilsService.lockAndDestroy(
        result.headerId,
        this.tableName,
        'id',
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE BOOKING ORDERAN HEADER',
          idtransss: id,
          nobuktitrans: id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby,
        },
        trx,
      );

      return {
        status: 200,
        message: 'Data deleted successfully',
        deletedData,
      };
    } catch (error) {
      console.error('Error deleting data: ', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }
}
