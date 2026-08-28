import {
  Injectable,
  InternalServerErrorException,
  HttpException,
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
      const tempTableName = `##temp_${Math.random().toString(36).substring(2, 15)}`;
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

      for (const data of details) {
        let isDataChanged = false;

        // Uppercase hanya kolom teks manusiawi. id (PK), orderan_id/
        // shippinginstruction_id/emkl_id/containerpelayaran_id/tujuankapal_id/
        // daftarbl_id (FK), status*, dan *_nobukti adalah UUID/kunci bertipe text
        // (case-sensitive); blanket uppercase meng-corrupt id/FK (mis. lookup
        // statuspendukung by orderan_id) sehingga lookup gagal.
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

        // Cek apakah ada detail orderan_id (UNTUK CREATE) atau engga,
        // kalo ada ambil data status pendukung orderan muatan untuk ambil nilai status pisah bl dari orderan
        if (orderan_id) {
          const getStatusDataPendukung = await trx('parameter')
            .select('id')
            .where('grp', 'DATA PENDUKUNG')
            .where('subgrp', 'ORDERANMUATAN')
            .where('text', 'PISAH BL')
            .first();

          const getStatusPisahBl = await trx('statuspendukung')
            .select('statuspendukung')
            .where('statusdatapendukung', getStatusDataPendukung.id)
            .where('transaksi_id', orderan_id)
            .first();

          detailsWithoutRincian.statuspisahbl =
            getStatusPisahBl?.statuspendukung
              ? getStatusPisahBl.statuspendukung
              : 15;
        } else {
          const getDataStatusPisahBl = await trx(this.tableName)
            .select('statuspisahbl')
            .where(
              'shippinginstructiondetail_nobukti',
              detailsWithoutRincian.shippinginstructiondetail_nobukti,
            )
            .first();

          detailsWithoutRincian.statuspisahbl =
            getDataStatusPisahBl.statuspisahbl;
        }

        if (data.shippinginstructiondetail_nobukti === '') {
          // Cek ada payload nobukti detail atau enggak, kalo gada buat
          const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
          const getcabang = await trx('parameter')
            .select(
              trx.raw(`JSON_VALUE(${memoExpr}, '$.CABANG_ID') AS cabang_id`),
            )
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

        // id kosong atau '0' = baris baru; pengirim antar-service memakai '0'.
        if (
          detailsWithoutRincian.id &&
          String(detailsWithoutRincian.id) !== '0'
        ) {
          const existingData = await trx(this.tableName)
            .where('id', detailsWithoutRincian.id)
            .first();

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
          }
        } else {
          const newTimestamps = {
            // New record: Set timestamps
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

      // const processedData = mainDataToInsert.map((item: any) => ({
      //   ...item,
      //   shippinginstruction_id: item.shippinginstruction_id ?? id,
      //   // statuspisahbl: 15,
      // }));

      const jsonString = JSON.stringify(mainDataToInsert);
      const mappingData = Object.keys(mainDataToInsert[0]).map((key) => [
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

      const updatedData = await trx(this.tableName)
        .join(`${tempTableName}`, `${this.tableName}.id`, `${tempTableName}.id`)
        .update({
          nobukti: trx.raw(`${tempTableName}.nobukti`),
          tglbukti: trx.raw(`${tempTableName}.tglbukti`),
          shippinginstructiondetail_nobukti: trx.raw(
            `${tempTableName}.shippinginstructiondetail_nobukti`,
          ),
          shippinginstruction_id: trx.raw(
            `${tempTableName}.shippinginstruction_id`,
          ),
          asalpelabuhan: trx.raw(`${tempTableName}.asalpelabuhan`),
          keterangan: trx.raw(`${tempTableName}.keterangan`),
          consignee: trx.raw(`${tempTableName}.consignee`),
          shipper: trx.raw(`${tempTableName}.shipper`),
          comodity: trx.raw(`${tempTableName}.comodity`),
          notifyparty: trx.raw(`${tempTableName}.notifyparty`),
          totalgw: trx.raw(`${tempTableName}.totalgw`),
          statuspisahbl: trx.raw(`${tempTableName}.statuspisahbl`),
          emkl_id: trx.raw(`${tempTableName}.emkl_id`),
          containerpelayaran_id: trx.raw(
            `${tempTableName}.containerpelayaran_id`,
          ),
          tujuankapal_id: trx.raw(`${tempTableName}.tujuankapal_id`),
          daftarbl_id: trx.raw(`${tempTableName}.daftarbl_id`),
          statusformat: trx.raw(`${tempTableName}.statusformat`),
          modifiedby: trx.raw(`${tempTableName}.modifiedby`),
          created_at: trx.raw(`${tempTableName}.created_at`),
          updated_at: trx.raw(`${tempTableName}.updated_at`),
        })
        .returning('*');

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

      const getDeleted = await trx(`${this.tableName} as u`)
        .leftJoin(`${tempTableName}`, 'u.id', `${tempTableName}.id`)
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
        .whereNull(`${tempTableName}.id`)
        .where('u.shippinginstruction_id', id);

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
          `${this.tableName}.id`,
          `${tempTableName}.id`,
        )
        .whereNull(`${tempTableName}.id`)
        .where(`${this.tableName}.shippinginstruction_id`, id)
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
        // Map rincian dengan ID detail yang benar
        const rincianItem = allRincian[i];

        // Panggil service rincian jika ada data rincian
        if (rincianItem.rincian && rincianItem.rincian.length > 0) {
          // Tambahkan keperluan data lainnya ke setiap rincian
          const fixDataRincian = rincianItem.rincian.map((r: any) => ({
            ...r,
            shippinginstructiondetail_id: allDetails[i].id,
            shippinginstructiondetail_nobukti:
              allDetails[i].shippinginstructiondetail_nobukti,
          }));

          const test =
            await this.shippingInstructionDetailRincianService.create(
              fixDataRincian,
              allDetails[i].id,
              trx,
            );
        }
      }
      console.log('insertedData', insertedData, 'updatedData', updatedData);

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

      // throw new Error('test')
      return updatedData || insertedData;
    } catch (error) {
      console.error(
        'Error process creating shipping instruction detail in service:',
        error.message,
      );
      if (error instanceof HttpException) {
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
      // const { tglDari, tglSampai, ...filtersWithoutTanggal } = filters ?? {};

      let { page, limit } = pagination ?? {};
      page = page ?? 1;
      limit = limit ?? 0;

      const query = trx(`${this.tableName} as p`)
        .select(
          'p.id',
          'p.shippinginstruction_id',
          'p.nobukti',
          // trx.raw("TO_CHAR(p.tglbukti, 'DD-MM-YYYY') as tglbukti"),
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
          'parameter.text as statuspisahbl_nama',
          'parameter.memo as statuspisahbl_memo',
          'emkl.nama as emkllain_nama',
          'pel.nama as containerpelayaran_nama',
          'tjk.nama as tujuankapal_nama',
          'bl.nama as daftarbl_nama',
        )
        .leftJoin('parameter', 'p.statuspisahbl', 'parameter.id')
        .leftJoin('emkl', 'p.emkl_id', 'emkl.id')
        .leftJoin('pelayaran as pel', 'p.containerpelayaran_id', 'pel.id')
        .leftJoin('tujuankapal as tjk', 'p.tujuankapal_id', 'tjk.id')
        .leftJoin('daftarbl as bl', 'p.daftarbl_id', 'bl.id')
        .where('shippinginstruction_id', id);

      const excludeSearchKeys = ['statuspisahbl_text'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (field === 'detail_nobukti') {
              qb.orWhere(
                `p.shippinginstructiondetail_nobukti`,
                'like',
                `%${sanitized}%`,
              );
            } else if (field === 'emkllain_text') {
              qb.orWhere(`emkl.nama`, 'like', `%${sanitized}%`);
            } else if (field === 'containerpelayaran_text') {
              qb.orWhere(`pel.nama`, 'like', `%${sanitized}%`);
            } else if (field === 'tujuankapal_text') {
              qb.orWhere(`tjk.nama`, 'like', `%${sanitized}%`);
            } else if (field === 'daftarbl_text') {
              qb.orWhere(`bl.nama`, 'like', `%${sanitized}%`);
            } else {
              qb.orWhere(`p.${field}`, 'like', `%${sanitized}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');
          if (value) {
            if (key === 'detail_nobukti') {
              query.andWhere(
                `p.shippinginstructiondetail_nobukti`,
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'emkllain_text') {
              query.andWhere(`emkl.nama`, 'like', `%${sanitizedValue}%`);
            } else if (key === 'containerpelayaran_text') {
              query.andWhere(`pel.nama`, 'like', `%${sanitizedValue}%`);
            } else if (key === 'tujuankapal_text') {
              query.andWhere(`tjk.nama`, 'like', `%${sanitizedValue}%`);
            } else if (key === 'daftarbl_text') {
              query.andWhere(`bl.nama`, 'like', `%${sanitizedValue}%`);
            } else if (key === 'statuspisahbl_text') {
              query.andWhere('parameter.id', '=', sanitizedValue);
            } else {
              query.andWhere(`p.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'detail_nobukti') {
          query.orderBy(
            `p.shippinginstructiondetail_nobukti`,
            sort.sortDirection,
          );
        } else if (sort?.sortBy === 'emkllain_text') {
          query.orderBy(`emkl.nama`, sort.sortDirection);
        } else if (sort?.sortBy === 'containerpelayaran_text') {
          query.orderBy(`pel.nama`, sort.sortDirection);
        } else if (sort?.sortBy === 'tujuankapal_text') {
          query.orderBy(`tjk.nama`, sort.sortDirection);
        } else if (sort?.sortBy === 'daftarbl_text') {
          query.orderBy('bl.nama', sort.sortDirection);
        } else if (sort?.sortBy === 'statuspisahbl_text') {
          query.orderBy('parameter.text', sort.sortDirection);
        } else {
          query.orderBy(sort.sortBy, sort.sortDirection);
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
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete data shipping instruction detail in service',
      );
    }
  }
}
