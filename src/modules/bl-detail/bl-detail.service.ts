import {
  Injectable,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { CreateBlDetailDto } from './dto/create-bl-detail.dto';
import { UpdateBlDetailDto } from './dto/update-bl-detail.dto';
import { withUuidV7, UtilsService } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { BlDetailRincianService } from '../bl-detail-rincian/bl-detail-rincian.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class BlDetailService {
  private readonly tableName: string = 'bldetail';

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly blDetailRincianService: BlDetailRincianService,
  ) {}

  async create(details: any, id: any = 0, trx: any = null) {
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
        await trx(this.tableName).delete().where('bl_id', id);
        return;
      }

      for (const data of details) {
        let isDataChanged = false;

        // Uppercase hanya kolom teks manusiawi. id (PK), bl_id (FK), dan
        // *_nobukti/*_uuid adalah UUID/kunci bertipe text (case-sensitive);
        // blanket uppercase meng-corrupt id sehingga lookup-by-id gagal (edit
        // jadi hapus+insert baris baru).
        ['keterangan', 'noblconecting'].forEach((field) => {
          if (typeof data[field] === 'string') {
            data[field] = data[field].toUpperCase();
          }
        });

        const { detailsrincian, ...detailsWithoutRincian } = data;

        // Extract dan simpan data rincian jika ada
        let tempRincian: any = {};
        if (detailsrincian && detailsrincian.length > 0) {
          tempRincian = {
            rincian: [...detailsrincian], // Copy array rincian
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
          bl_nobukti: trx.raw(`${tempTableName}.bl_nobukti`),
          bl_id: trx.raw(`${tempTableName}.bl_id`),
          keterangan: trx.raw(`${tempTableName}.keterangan`),
          noblconecting: trx.raw(`${tempTableName}.noblconecting`),
          shippinginstructiondetail_nobukti: trx.raw(
            `${tempTableName}.shippinginstructiondetail_nobukti`,
          ),
          info: trx.raw(`${tempTableName}.info`),
          modifiedby: trx.raw(`${tempTableName}.modifiedby`),
          created_at: trx.raw(`${tempTableName}.created_at`),
          updated_at: trx.raw(`${tempTableName}.updated_at`),
        })
        .returning('*');

      const insertedDataQuery = await trx(tempTableName)
        .select([
          'nobukti',
          'bl_nobukti',
          'bl_id',
          'keterangan',
          'noblconecting',
          'shippinginstructiondetail_nobukti',
          'info',
          'modifiedby',
          'created_at',
          'updated_at',
        ])
        .where(`${tempTableName}.id`, '0');

      const getDeleted = await trx(`${this.tableName} as u`)
        .leftJoin(`${tempTableName}`, 'u.id', `${tempTableName}.id`)
        .select(
          'u.nobukti',
          'u.bl_nobukti',
          'u.bl_id',
          'u.keterangan',
          'u.noblconecting',
          'u.shippinginstructiondetail_nobukti',
          'u.info',
          'u.modifiedby',
          'u.created_at',
          'u.updated_at',
        )
        .whereNull(`${tempTableName}.id`)
        .where('u.bl_id', id);

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
        .where(`${this.tableName}.bl_id`, id)
        .del();

      // Insert new records
      if (insertedDataQuery.length > 0) {
        insertedData = await trx(this.tableName)
          .insert(await withUuidV7(trx, insertedDataQuery))
          .returning('*');
      }

      // PROSES DETAIL RINCIAN, Gabungkan detail yang sudah ada dengan yang baru diinsert
      const allDetails = [...(updatedData || []), ...(insertedData || [])];

      for (let i = 0; i < allRincian.length; i++) {
        // Map rincian dengan ID detail yang benar
        const rincianItem = allRincian[i];

        // Panggil service rincian jika ada data rincian
        if (rincianItem.rincian && rincianItem.rincian.length > 0) {
          // Tambahkan keperluan data lainnya ke setiap rincian
          const fixDataRincian = rincianItem.rincian.map((r: any) => ({
            ...r,
            bldetail_id: allDetails[i].id,
            bldetail_nobukti: allDetails[i].bl_nobukti,
          }));

          const test = await this.blDetailRincianService.create(
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
          postingdari: 'ADD BL DETAIL',
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
        'Error process creating bl detail in service:',
        error.message,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process creating bl detail in service',
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

      const query = trx(`${this.tableName} as u`)
        .select(
          'u.id',
          'u.nobukti',
          'u.bl_id',
          'u.bl_nobukti',
          'u.keterangan',
          'u.noblconecting',
          'u.shippinginstructiondetail_nobukti',
          'si.asalpelabuhan',
          'si.consignee',
          'si.shipper',
          'si.comodity',
          'si.notifyparty',
          'parameter.text as statuspisahbl_nama',
          'parameter.memo as statuspisahbl_memo',
          'emkl.nama as emkllain_nama',
          'pel.nama as pelayaran_nama',
        )
        .leftJoin(
          'shippinginstructiondetail as si',
          'u.shippinginstructiondetail_nobukti',
          'si.shippinginstructiondetail_nobukti',
        )
        .leftJoin('parameter', 'si.statuspisahbl', 'parameter.id')
        .leftJoin('emkl', 'si.emkl_id', 'emkl.id')
        .leftJoin('pelayaran as pel', 'si.containerpelayaran_id', 'pel.id')
        .where('bl_id', id);

      const excludeSearchKeys = ['statuspisahbl_text'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (
              field === 'asalpelabuhan' ||
              field === 'consignee' ||
              field === 'shipper' ||
              field === 'comodity' ||
              field === 'notifyparty'
            ) {
              qb.orWhere(`si.${field}`, 'like', `%${sanitized}%`);
            } else if (field === 'emkllain_text') {
              qb.orWhere(`emkl.nama`, 'like', `%${sanitized}%`);
            } else if (field === 'pelayaran_text') {
              qb.orWhere(`pel.nama`, 'like', `%${sanitized}%`);
            } else {
              qb.orWhere(`u.${field}`, 'like', `%${sanitized}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');
          if (value) {
            if (
              key === 'asalpelabuhan' ||
              key === 'consignee' ||
              key === 'shipper' ||
              key === 'comodity' ||
              key === 'notifyparty'
            ) {
              query.andWhere(`si.${key}`, 'like', `%${sanitizedValue}%`);
            } else if (key === 'emkllain_text') {
              query.andWhere(`emkl.nama`, 'like', `%${sanitizedValue}%`);
            } else if (key === 'pelayaran_text') {
              query.andWhere(`pel.nama`, 'like', `%${sanitizedValue}%`);
            } else if (key === 'statuspisahbl_text') {
              query.andWhere('parameter.id', '=', sanitizedValue);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (
          sort.sortBy === 'asalpelabuhan' ||
          sort.sortBy === 'consignee' ||
          sort.sortBy === 'shipper' ||
          sort.sortBy === 'comodity' ||
          sort.sortBy === 'notifyparty'
        ) {
          query.orderBy(`si.${sort.sortBy}`, sort.sortDirection);
        } else if (sort?.sortBy === 'emkllain_text') {
          query.orderBy(`emkl.nama`, sort.sortDirection);
        } else if (sort?.sortBy === 'pelayaran_text') {
          query.orderBy(`pel.nama`, sort.sortDirection);
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

  findOne(id: string) {
    return `This action returns a #${id} blDetail`;
  }

  update(id: string, updateBlDetailDto: UpdateBlDetailDto) {
    return `This action updates a #${id} blDetail`;
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
          postingdari: 'DELETE BL DETAIL',
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
      console.log('Error deleting data bl detail in service:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete data bl detail in service',
      );
    }
  }
}
