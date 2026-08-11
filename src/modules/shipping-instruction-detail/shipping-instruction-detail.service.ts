import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateShippingInstructionDetailDto } from './dto/create-shipping-instruction-detail.dto';
import { UpdateShippingInstructionDetailDto } from './dto/update-shipping-instruction-detail.dto';
import { withUuidV7, UtilsService } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { ShippingInstructionDetailRincianService } from '../shipping-instruction-detail-rincian/shipping-instruction-detail-rincian.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';

@Injectable()
export class ShippingInstructionDetailService {
  private readonly tableName: string = 'shippinginstructiondetail';
  private readonly viewName: string = 'vshippinginstructiondetail';

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly shippingInstructionDetailRincianService: ShippingInstructionDetailRincianService,
  ) {}

  async create(details: any, id: any, trx: any) {
    try {
      const allRincian: any[] = []; // Ambil semua data rincian di luar mapping utama
      let insertedData = null;
      const logData: any[] = [];
      const mainDataToInsert: any[] = [];
      const time = this.utilsService.getTime();
      const tempTableName = `temp_${Math.random().toString(36).substring(2, 15)}`;
      const tableTemp = await this.utilsService.createTempTable(
        this.tableName,
        trx,
        tempTableName,
      );

      if (details.length === 0) {
        await trx(this.tableName).delete().where('shippinginstruction_id', id);
        return;
      }

      const getFormatShippingDetail = await trx('parameter')
        .select('id', 'grp', 'subgrp')
        .where('grp', 'NOMOR SHIPPING INSTRUCTION DETAIL')
        .where('kelompok', 'SHIPPING INSTRUCTION DETAIL')
        .first();

      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
      const getStatusDataPendukung = await trx('parameter')
        .select(
          'id',
          trx.raw(`JSON_VALUE(${memoExpr}, '$."NILAI TIDAK"') AS nilai_tidak`),
        )
        .where('grp', 'DATA PENDUKUNG')
        .where('subgrp', 'ORDERANMUATAN')
        .where('text', 'PISAH BL')
        .first();

      const defaultStatusPisahBl = getStatusDataPendukung?.nilai_tidak ?? null;

      for (const data of details) {
        let isDataChanged = false;

        [
          'asalpelabuhan',
          'keterangan',
          'consignee',
          'shipper',
          'comodity',
          'notifyparty',
        ].forEach((field) => {
          if (typeof data[field] === 'string') {
            data[field] = data[field].toUpperCase();
          }
        });

        const { detailsrincian, orderan_id, ...detailsWithoutRincian } = data;
        detailsWithoutRincian.statusformat = getFormatShippingDetail.id;

        if (orderan_id && getStatusDataPendukung?.id) {
          const getStatusPisahBl = await trx('statuspendukung')
            .select('statuspendukung')
            .where('statusdatapendukung', getStatusDataPendukung.id)
            .where('transaksi_id', orderan_id)
            .first();

          detailsWithoutRincian.statuspisahbl =
            getStatusPisahBl?.statuspendukung ?? defaultStatusPisahBl;
        } else {
          const getDataStatusPisahBl = await trx(this.tableName)
            .select('statuspisahbl')
            .where(
              'shippinginstructiondetail_nobukti',
              detailsWithoutRincian.shippinginstructiondetail_nobukti,
            )
            .first();

          detailsWithoutRincian.statuspisahbl =
            getDataStatusPisahBl?.statuspisahbl ?? defaultStatusPisahBl;
        }

        if (data.shippinginstructiondetail_nobukti === '') {
          // Cek ada payload nobukti detail atau enggak, kalo gada buat
          const getcabang = await trx('parameter')
            .select(trx.raw(`(memo::jsonb ->> 'CABANG_ID') AS cabang_id`))
            .where('grp', 'CABANG')
            .first();

          const nomorBukti =
            await this.runningNumberService.generateRunningNumber(
              trx,
              getFormatShippingDetail.grp,
              getFormatShippingDetail.subgrp,
              this.tableName,
              data.tglbukti,
              getcabang.cabang_id,
              data.tujuankapal_id,
              null,
              null,
              data.containerpelayaran_id,
              'shippinginstructiondetail_nobukti',
            );
          detailsWithoutRincian.shippinginstructiondetail_nobukti = nomorBukti;
        }

        // Extract dan simpan data rincian jika ada
        let tempRincian: any = {};
        if (data.detailsrincian && data.detailsrincian.length > 0) {
          tempRincian = {
            rincian: [...data.detailsrincian], // Copy array rincian
          };
        }

        if (tempRincian) {
          allRincian.push(tempRincian);
        }

        let existingData: any = null;
        if (
          detailsWithoutRincian.id !== null &&
          detailsWithoutRincian.id !== undefined &&
          String(detailsWithoutRincian.id) !== '' &&
          String(detailsWithoutRincian.id) !== '0'
        ) {
          existingData = await trx(this.tableName)
            .where('id', detailsWithoutRincian.id)
            .first();
        }

        if (existingData) {
          const createdAt = {
            created_at: existingData.created_at,
            updated_at: existingData.updated_at,
          };
          Object.assign(detailsWithoutRincian, createdAt);

          if (
            this.utilsService.hasChanges(detailsWithoutRincian, existingData)
          ) {
            detailsWithoutRincian.updated_at = time;
            isDataChanged = true;
            detailsWithoutRincian.aksi = 'UPDATE';
          }
        } else {
          detailsWithoutRincian.id = 0;
          const newTimestamps = {
            created_at: time,
            updated_at: time,
          };
          Object.assign(detailsWithoutRincian, newTimestamps);
          isDataChanged = true;
          detailsWithoutRincian.aksi = 'CREATE';
        }

        if (!isDataChanged) {
          detailsWithoutRincian.aksi = 'NO UPDATE';
        }

        const { aksi, ...dataForInsert } = detailsWithoutRincian;
        mainDataToInsert.push(dataForInsert);
        logData.push({
          ...detailsWithoutRincian,
          created_at: time,
        });
      }

      await trx.raw(tableTemp);

      const jsonString = JSON.stringify(mainDataToInsert);

      await trx.raw(
        `insert into "${tempTableName}" select * from jsonb_populate_recordset(null::${this.tableName}, ?::jsonb)`,
        [jsonString],
      );

      const updatedResult = await trx.raw(
        `update ${this.tableName} as t set
           nobukti = tmp.nobukti,
           tglbukti = tmp.tglbukti,
           shippinginstructiondetail_nobukti = tmp.shippinginstructiondetail_nobukti,
           shippinginstruction_id = tmp.shippinginstruction_id,
           asalpelabuhan = tmp.asalpelabuhan,
           keterangan = tmp.keterangan,
           consignee = tmp.consignee,
           shipper = tmp.shipper,
           comodity = tmp.comodity,
           notifyparty = tmp.notifyparty,
           totalgw = tmp.totalgw,
           statuspisahbl = tmp.statuspisahbl,
           emkl_id = tmp.emkl_id,
           containerpelayaran_id = tmp.containerpelayaran_id,
           tujuankapal_id = tmp.tujuankapal_id,
           daftarbl_id = tmp.daftarbl_id,
           statusformat = tmp.statusformat,
           modifiedby = tmp.modifiedby,
           created_at = tmp.created_at,
           updated_at = tmp.updated_at
         from "${tempTableName}" as tmp
         where t.id = tmp.id
         returning t.*`,
      );
      const updatedData = updatedResult?.rows ?? [];

      const insertedDataQuery = await trx(tempTableName)
        .select([
          'nobukti',
          'tglbukti',
          'shippinginstructiondetail_nobukti',
          'shippinginstruction_id',
          'asalpelabuhan',
          'keterangan',
          'consignee',
          'shipper',
          'comodity',
          'notifyparty',
          'totalgw',
          'statuspisahbl',
          'emkl_id',
          'containerpelayaran_id',
          'tujuankapal_id',
          'daftarbl_id',
          'statusformat',
          'modifiedby',
          'created_at',
          'updated_at',
        ])
        .where(`${tempTableName}.id`, '0');

      const notInTemp = (qb: any) => {
        qb.whereNotExists(function (this: any) {
          this.select(trx.raw('1'))
            .from(tempTableName)
            .whereRaw(`"${tempTableName}".id = u.id`);
        });
      };

      const getDeleted = await trx(`${this.tableName} as u`)
        .select(
          'u.nobukti',
          'u.tglbukti',
          'u.shippinginstructiondetail_nobukti',
          'u.shippinginstruction_id',
          'u.asalpelabuhan',
          'u.keterangan',
          'u.consignee',
          'u.shipper',
          'u.comodity',
          'u.notifyparty',
          'u.totalgw',
          'u.statuspisahbl',
          'u.emkl_id',
          'u.containerpelayaran_id',
          'u.tujuankapal_id',
          'u.daftarbl_id',
          'u.statusformat',
          'u.modifiedby',
          'u.created_at',
          'u.updated_at',
        )
        .where('u.shippinginstruction_id', id)
        .modify(notInTemp);

      const pushToLogWithAction = getDeleted.map((entry: any) => ({
        ...entry,
        aksi: 'DELETE',
      }));

      const finalData = logData.concat(pushToLogWithAction);

      await trx(`${this.tableName} as u`)
        .where('u.shippinginstruction_id', id)
        .modify(notInTemp)
        .del();

      // Insert new records
      if (insertedDataQuery.length > 0) {
        insertedData = await trx(this.tableName)
          .insert(await withUuidV7(trx, insertedDataQuery))
          .returning('*');
      }

      // PROSES DETAIL RINCIAN
      // Gabungkan detail yang sudah ada dengan yang baru diinsert
      const allDetails = [...(updatedData || []), ...(insertedData || [])];

      for (let i = 0; i < allRincian.length; i++) {
        const rincianItem = allRincian[i];

        if (rincianItem.rincian && rincianItem.rincian.length > 0) {
          const fixDataRincian = rincianItem.rincian.map((r: any) => ({
            ...r,
            shippinginstructiondetail_id: allDetails[i]?.id,
            shippinginstructiondetail_nobukti:
              allDetails[i]?.shippinginstructiondetail_nobukti,
          }));

          await this.shippingInstructionDetailRincianService.create(
            fixDataRincian,
            allDetails[i]?.id,
            trx,
          );
        }
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD SHIPPING INSTRUCTION DETAIL',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(finalData),
          modifiedby: details[0].modifiedby,
        },
        trx,
      );

      return updatedData || insertedData;
    } catch (error) {
      console.error(
        'Error process creating shipping instruction detail in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process creating shipping instruction detail in service',
      );
    }
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

      const query = trx(`${this.viewName} as p`)
        .select(
          'p.id',
          'p.shippinginstruction_id',
          'p.nobukti',
          'p.shippinginstructiondetail_nobukti',
          'p.asalpelabuhan',
          'p.keterangan',
          'p.consignee',
          'p.shipper',
          'p.comodity',
          'p.notifyparty',
          'p.totalgw',
          'p.statuspisahbl',
          'p.emkl_id',
          'p.containerpelayaran_id',
          'p.tujuankapal_id',
          'p.daftarbl_id',
          'p.statuspisahbl_nama',
          'p.statuspisahbl_memo',
          'p.emkllain_nama',
          'p.containerpelayaran_nama',
          'p.tujuankapal_nama',
          'p.daftarbl_nama',
        )
        .where('p.shippinginstruction_id', id);

      const excludeSearchKeys = ['statuspisahbl_text'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (search) {
        const sanitized = String(search).trim();

        query.where((qb: any) => {
          searchFields.forEach((field) => {
            if (field === 'detail_nobukti') {
              qb.orWhere(
                'p.shippinginstructiondetail_nobukti',
                'ilike',
                `%${sanitized}%`,
              );
            } else if (field === 'emkllain_text') {
              qb.orWhere('p.emkllain_nama', 'ilike', `%${sanitized}%`);
            } else if (field === 'containerpelayaran_text') {
              qb.orWhere(
                'p.containerpelayaran_nama',
                'ilike',
                `%${sanitized}%`,
              );
            } else if (field === 'tujuankapal_text') {
              qb.orWhere('p.tujuankapal_nama', 'ilike', `%${sanitized}%`);
            } else if (field === 'daftarbl_text') {
              qb.orWhere('p.daftarbl_nama', 'ilike', `%${sanitized}%`);
            } else {
              qb.orWhere(`p.${field}`, 'ilike', `%${sanitized}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value === null || value === undefined || value === '') continue;

          const sanitizedValue = String(value);
          if (key === 'detail_nobukti') {
            query.andWhere(
              'p.shippinginstructiondetail_nobukti',
              'ilike',
              `%${sanitizedValue}%`,
            );
          } else if (key === 'emkllain_text') {
            query.andWhere('p.emkllain_nama', 'ilike', `%${sanitizedValue}%`);
          } else if (key === 'containerpelayaran_text') {
            query.andWhere(
              'p.containerpelayaran_nama',
              'ilike',
              `%${sanitizedValue}%`,
            );
          } else if (key === 'tujuankapal_text') {
            query.andWhere(
              'p.tujuankapal_nama',
              'ilike',
              `%${sanitizedValue}%`,
            );
          } else if (key === 'daftarbl_text') {
            query.andWhere('p.daftarbl_nama', 'ilike', `%${sanitizedValue}%`);
          } else if (key === 'statuspisahbl_text') {
            query.andWhere('p.statuspisahbl', '=', sanitizedValue);
          } else {
            query.andWhere(`p.${key}`, 'ilike', `%${sanitizedValue}%`);
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        const sortDirection =
          String(sort.sortDirection).toLowerCase() === 'desc' ? 'desc' : 'asc';

        if (sort.sortBy === 'detail_nobukti') {
          query.orderBy('p.shippinginstructiondetail_nobukti', sortDirection);
        } else if (sort.sortBy === 'emkllain_text') {
          query.orderBy('p.emkllain_nama', sortDirection);
        } else if (sort.sortBy === 'containerpelayaran_text') {
          query.orderBy('p.containerpelayaran_nama', sortDirection);
        } else if (sort.sortBy === 'tujuankapal_text') {
          query.orderBy('p.tujuankapal_nama', sortDirection);
        } else if (sort.sortBy === 'daftarbl_text') {
          query.orderBy('p.daftarbl_nama', sortDirection);
        } else if (sort.sortBy === 'statuspisahbl_text') {
          query.orderBy('p.statuspisahbl_nama', sortDirection);
        } else {
          query.orderBy(`p.${sort.sortBy}`, sortDirection);
        }
      }

      const result = await query;

      return {
        data: result,
      };
    } catch (error) {
      console.error('Error to findAll Schedule detail in service', error);
      throw new Error(error);
    }
  }

  update(
    id: number,
    updateShippingInstructionDetailDto: UpdateShippingInstructionDetailDto,
  ) {
    return `This action updates a #${id} shippingInstructionDetail`;
  }

  async delete(id: string, trx: any, modifiedby: any) {
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
          postingdari: 'DELETE SHIPPING INSTRUCTION DETAIL',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby.toUpperCase(),
        },
        trx,
      );

      return { status: 200, message: 'Data deleted successfully', deletedData };
    } catch (error) {
      console.log(
        'Error deleting data shipping instruction detail in service:',
        error,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete data shipping instruction detail in service',
      );
    }
  }
}
