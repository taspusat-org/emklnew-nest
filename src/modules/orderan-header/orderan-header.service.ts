import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { CreateOrderanHeaderDto } from './dto/create-orderan-header.dto';
import { UpdateOrderanHeaderDto } from './dto/update-orderan-header.dto';
import { RedisService } from 'src/common/redis/redis.service';
import { withUuidV7, formatDateToSQL, UtilsService  } from 'src/utils/utils.service';
import { LocksService } from '../locks/locks.service';
import { GlobalService } from '../global/global.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { StatusjobService } from '../statusjob/statusjob.service';
import { OrderanMuatanService } from './orderan-muatan.service';

@Injectable()
export class OrderanHeaderService {
  private readonly tableName: string = 'orderanheader';

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
    private readonly statusJobService: StatusjobService,
    private readonly runningNumberService: RunningNumberService,
    private readonly orderanMuatanService: OrderanMuatanService,
  ) {}
  create(createOrderanHeaderDto: CreateOrderanHeaderDto) {
    return 'This action adds a new orderanHeader';
  }

  findAll() {
    return `This action returns all orderanHeader`;
  }

  findOne(id: string) {
    return `This action returns a #${id} orderanHeader`;
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
        ...orderanData
      } = data;

      let serviceUpdate;
      let serviceFindAll;
      const headerData = {
        nobukti,
        tglbukti,
        jenisorder_id,
        // statusformat: 0,
        modifiedby: data.modifiedby,
        updated_at: '',
      };

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

      switch (jenisorder_id) {
        case getJenisOrderanMuatan?.id:
          serviceUpdate = this.orderanMuatanService;
          serviceFindAll = this.orderanMuatanService;
          break;
        // case 'IMPORT':
        //   service = this.hitungmodalimportService;
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          serviceUpdate = this.orderanMuatanService;
          serviceFindAll = this.orderanMuatanService;
          break;
      }

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
        const test = await trx(this.tableName)
          .where('id', id)
          .update(headerData)
          .returning('*');
      }

      const updateOrderan = await serviceUpdate.update(
        nobukti,
        orderanData,
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT ORDERAN HEADER',
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
        (item) => String(item.id) === String(updateOrderan.id),
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
        // newItems: {
        //   // idBookingOrderan,
        //   ...data,
        // },
        pageNumber,
        dataIndex,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      console.error('Error updating orderan header:', error);
      throw new Error('Failed to update orderan header');
    }
  }

  async delete(id: string, trx: any, modifiedby: string, data: any) {
    try {
      let deleteService;
      let nobukti;
      let idBookingHeader;
      let idBooking;
      let tableNameBooking;
      let getParameterStatusJobTglBooking;
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

      switch (data.jenisOrderan) {
        case getJenisOrderanMuatan?.id:
          deleteService = this.orderanMuatanService;
          nobukti = await trx('orderanmuatan')
            .select('nobukti')
            .where('id', id)
            .first();
          idBookingHeader = await trx('bookingorderanheader')
            .select('id')
            .where('orderan_nobukti', nobukti.nobukti)
            .first();
          idBooking = await trx('bookingorderanmuatan')
            .select('id')
            .where('bookingorderan_id', idBookingHeader.id)
            .first();
          tableNameBooking = 'BOOKINGORDERANMUATAN';
          break;
        // case 'IMPORT':
        //   service = this.hitungmodalimportService;
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          deleteService = this.orderanMuatanService;
          nobukti = await trx('orderanmuatan')
            .select('nobukti')
            .where('id', id)
            .first();
          idBookingHeader = await trx('bookingorderanheader')
            .select('id')
            .where('orderan_nobukti', nobukti.nobukti)
            .first();
          idBooking = await trx('bookingorderanmuatan')
            .select('id')
            .where('bookingorderan_id', idBookingHeader.id)
            .first();
          tableNameBooking = 'BOOKINGORDERANMUATAN';
          break;
      }

      const result = await deleteService.delete(nobukti.nobukti, trx); // DELETE DATA ORDERAN
      const deletedData = await this.utilsService.lockAndDestroy(
        // DELETE DATA ORDERAN HEADER
        result.headerId,
        this.tableName,
        'id',
        trx,
      );

      if (deletedData) {
        // UPDATE orderan_nobukti di bookingheader jadi null
        await trx('bookingorderanheader')
          .where('orderan_nobukti', nobukti.nobukti)
          .update('orderan_nobukti', null);

        // UPDATE DATA STATUS PENDUKUNG BOOKING ORDERAN JADI NILAI TIDAK/ NONAPPROVAL
        const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
        const getDataPendukungApprovalBooking = await trx('parameter')
          .select(
            'id',
            trx.raw(
              `JSON_VALUE(${memoExpr}, '$."NILAI TIDAK"') AS nilai_tidak`,
            ),
          )
          .where('grp', 'DATA PENDUKUNG')
          .where('subgrp', tableNameBooking)
          .where('text', 'APPROVAL TRANSAKSI')
          .first();

        await trx('statuspendukung')
          .where('statusdatapendukung', getDataPendukungApprovalBooking.id)
          .where('transaksi_id', idBooking.id)
          .update(
            'statuspendukung',
            getDataPendukungApprovalBooking.nilai_tidak,
          )
          .update('updated_at', this.utilsService.getTime());

        // DELETE DATA STATUS JOB TGL BOOKING PAS PERTAMA KALI APPROVAL BOOKING
        getParameterStatusJobTglBooking = await trx('parameter')
          .select('id')
          .where('grp', 'STATUS JOB')
          .where('text', 'TGL BOOKING')
          .first();

        const getDataStatusJob = await trx('statusjob')
          .where('statusjob', getParameterStatusJobTglBooking.id)
          .where('job', idBooking.id)
          .first();
        if (getDataStatusJob) {
          await this.utilsService.lockAndDestroy(
            getDataStatusJob.id,
            'statusjob',
            'id',
            trx,
          );
        }
      }

      // DELETE DATA STATUS JOB YG ORDERANNYA ADA DI STATUS JOB
      const getDataStatusJobOrderan = await trx('statusjob')
        .where('job', result.id)
        .whereNot('id', getParameterStatusJobTglBooking.id);
      if (getDataStatusJobOrderan && getDataStatusJobOrderan.length > 0) {
        for (const [index, item] of getDataStatusJobOrderan.entries()) {
          await this.utilsService.lockAndDestroy(
            item.id,
            'statusjob',
            'id',
            trx,
          );
        }
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE ORDERAN HEADER',
          idtransss: deletedData.id,
          nobuktitrans: deletedData.id,
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
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }

  async approval(data: any, trx: any) {
    try {
      data.tanggal = formatDateToSQL(data.tanggal);
      data.created_at = this.utilsService.getTime();
      data.updated_at = this.utilsService.getTime();
      let formatNoBuktiOrderan;
      let serviceCreate;
      const {
        mode,
        bookingheader_id,
        booking_id,
        jenisorder_id,
        tanggal,
        marketing_id,
        tujuankapal_id,
        ...approvalData
      } = data;

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

      switch (jenisorder_id) {
        case getJenisOrderanMuatan?.id:
          serviceCreate = this.orderanMuatanService;
          formatNoBuktiOrderan = await trx
            .from(trx.raw(`parameter`))
            .select(['id', 'grp', 'subgrp', 'text'])
            .where('grp', 'NOMOR ORDERAN MUATAN')
            .first();
          break;
        // case 'IMPORT':
        //   service = this.hitungmodalimportService;
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          serviceCreate = this.orderanMuatanService;
          formatNoBuktiOrderan = await trx
            .from(trx.raw(`parameter`))
            .select(['id', 'grp', 'subgrp', 'text'])
            .where('grp', 'NOMOR ORDERAN MUATAN')
            .first();
          break;
      }

      console.log('data', data, 'formatNoBuktiOrderan', formatNoBuktiOrderan);
      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        formatNoBuktiOrderan.grp,
        formatNoBuktiOrderan.subgrp,
        this.tableName,
        data.tanggal,
        null,
        tujuankapal_id,
        null,
        marketing_id,
      );

      const headerData = {
        nobukti: nomorBukti,
        tglbukti: tanggal,
        jenisorder_id: jenisorder_id,
        statusformat: formatNoBuktiOrderan.id,
        modifiedby: data.modifiedby,
        updated_at: data.created_at,
        created_at: data.updated_at,
      };

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

      const insertedData = await trx(this.tableName)
        .insert(await withUuidV7(trx, headerData))
        .returning('*');
      const newItem = insertedData[0];

      if (newItem) {
        await trx('bookingorderanheader')
          .where('id', bookingheader_id)
          .update('orderan_nobukti', newItem.nobukti);
      }

      await this.logTrailService.create(
        {
          namatable: this.tableName,
          postingdari: 'ADD ORDERAN HEADER',
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      // INSERT TO STATUS PENDUKUNG DAN STATUS JOB
      const statusJobData = {
        job: approvalData?.transaksi_id[0],
        tglstatus: headerData.tglbukti,
        jenisorder_id: jenisorder_id,
        grp: 'STATUS JOB',
        statusjob_nama: 'TGL BOOKING',
        modifiedby: headerData.modifiedby,
        created_at: approvalData.created_at,
        updated_at: approvalData.updated_at,
      };
      const storeStatusJob = await this.statusJobService.create(
        statusJobData,
        trx,
      );
      const approvalStatusPendukung = await this.globalService.approval(
        approvalData,
        trx,
      );

      // INSERT TO ORDERAN
      const orderanData = {
        booking_id: booking_id,
        orderan_id: newItem.id,
        nobukti: newItem.nobukti,
        modifiedby: newItem.modifiedby,
        updated_at: data.created_at,
        created_at: data.updated_at,
      };
      const insertOrderan = await serviceCreate.create(orderanData, trx);

      if (
        newItem &&
        insertOrderan &&
        storeStatusJob.status === approvalStatusPendukung.status
      ) {
        return {
          status: HttpStatus.OK,
          message: 'Proses Approval Booking Orderan Berhasil',
        };
      } else {
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Proses Approval Booking Orderan Gagal',
        };
      }
    } catch (error) {
      console.error(
        'Error processing approval in orderan header controller:',
        error,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to process approval in orderan header controller',
      );
    }
  }

  async nonApproval(data: any, trx: any) {
    try {
      let serviceDelete;
      data.created_at = this.utilsService.getTime();
      data.updated_at = this.utilsService.getTime();
      const { mode, jenisorder_id, orderan_nobukti, ...nonApprovalData } = data;

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

      switch (jenisorder_id) {
        case getJenisOrderanMuatan?.id:
          serviceDelete = this.orderanMuatanService;
          break;
        // case 'IMPORT':
        //   service = this.hitungmodalimportService;
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          serviceDelete = this.orderanMuatanService;
          break;
      }

      const statusJobData = {
        jenisorder_id: jenisorder_id,
        grp: 'STATUS JOB',
        text: 'TGL BOOKING',
        modifiedby: nonApprovalData.modifiedby,
        created_at: nonApprovalData.created_at,
        updated_at: nonApprovalData.updated_at,
      };

      const storeStatusJob = await this.statusJobService.delete(
        nonApprovalData?.transaksi_id[0],
        statusJobData,
        trx,
      );
      const approvalStatusPendukung = await this.globalService.nonApproval(
        nonApprovalData,
        trx,
      );
      const deletedOrderan = await serviceDelete.delete(orderan_nobukti, trx);
      const deletedOrderanHeader = await this.utilsService.lockAndDestroy(
        orderan_nobukti,
        this.tableName,
        'nobukti',
        trx,
      );

      if (deletedOrderan && deletedOrderanHeader) {
        await trx('bookingorderanheader')
          .where('orderan_nobukti', orderan_nobukti)
          .update('orderan_nobukti', null);
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE ORDERAN HEADER',
          idtrans: deletedOrderan.id,
          nobuktitrans: deletedOrderan.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedOrderan),
          modifiedby: deletedOrderan.modifiedby,
        },
        trx,
      );

      if (
        deletedOrderanHeader &&
        deletedOrderan &&
        storeStatusJob.status === approvalStatusPendukung.status
      ) {
        return {
          status: HttpStatus.OK,
          message: 'Proses Non Approval Booking Orderan Berhasil',
        };
      } else {
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Proses NonApproval Booking Orderan Gagal',
        };
      }
    } catch (error) {
      console.error(
        'Error processing non approval in orderan header controller:',
        error,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to process approval in orderan header controller',
      );
    }
  }
}
