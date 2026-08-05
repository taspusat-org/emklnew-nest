import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateShippingInstructionDetailRincianDto } from './dto/create-shipping-instruction-detail-rincian.dto';
import { UpdateShippingInstructionDetailRincianDto } from './dto/update-shipping-instruction-detail-rincian.dto';
import { withUuidV7, UtilsService } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class ShippingInstructionDetailRincianService {
  // tableName untuk TULIS, viewName untuk BACA (pola alatbayar). View sudah
  // memuat nocontainer, noseal, shipper_nama dari orderanmuatan + shipper.
  private readonly tableName: string = 'shippinginstructiondetailrincian';
  private readonly viewName: string = 'vshippinginstructiondetailrincian';

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}

  /**
   * Pola temp table dipertahankan seperti versi asli; hanya bagian sintaks SQL
   * Server yang diganti padanan Postgres. Penjelasan lengkap tiap penggantian
   * ada di ShippingInstructionDetailService.create.
   */
  async create(
    detailsrincian: any,
    shippinginstructiondetail_id: any,
    trx: any,
  ) {
    try {
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

      if (detailsrincian.length === 0) {
        await trx(this.tableName)
          .delete()
          .where('shippinginstructiondetail_id', shippinginstructiondetail_id);
        return;
      }

      for (const data of detailsrincian) {
        let isDataChanged = false;

        // Uppercase hanya kolom teks manusiawi. id (PK), shippinginstructiondetail_id
        // (FK), dan *_nobukti adalah UUID/kunci bertipe text (case-sensitive);
        // blanket uppercase meng-corrupt id sehingga lookup-by-id gagal.
        ['comodity', 'keterangan'].forEach((field) => {
          if (typeof data[field] === 'string') {
            data[field] = data[field].toUpperCase();
          }
        });

        // Baris dianggap LAMA hanya bila id-nya benar-benar ada di DB.
        let existingData: any = null;
        if (
          data.id !== null &&
          data.id !== undefined &&
          String(data.id) !== '' &&
          String(data.id) !== '0'
        ) {
          existingData = await trx(this.tableName).where('id', data.id).first();
        }

        if (existingData) {
          const createdAt = {
            created_at: existingData.created_at,
            updated_at: existingData.updated_at,
          };
          Object.assign(data, createdAt);

          if (this.utilsService.hasChanges(data, existingData)) {
            data.updated_at = time;
            isDataChanged = true;
            data.aksi = 'UPDATE';
          }
        } else {
          data.id = 0;
          const newTimestamps = {
            created_at: time,
            updated_at: time,
          };
          Object.assign(data, newTimestamps);
          isDataChanged = true;
          data.aksi = 'CREATE';
        }

        if (!isDataChanged) {
          data.aksi = 'NO UPDATE';
        }

        // Hanya kolom milik tabel yang ikut ke temp. Payload grid membawa field
        // tampilan (idOrderan, nocontainer, noseal, shipper_id, shipper_nama,
        // isNew) yang tidak punya kolom — jsonb_populate_recordset memang
        // mengabaikannya, tapi dibuang di sini supaya niatnya eksplisit.
        mainDataToInsert.push({
          id: data.id,
          nobukti: data.nobukti,
          shippinginstructiondetail_id:
            data.shippinginstructiondetail_id ?? shippinginstructiondetail_id,
          shippinginstructiondetail_nobukti:
            data.shippinginstructiondetail_nobukti,
          orderanmuatan_nobukti: data.orderanmuatan_nobukti,
          comodity: data.comodity,
          keterangan: data.keterangan,
          modifiedby: data.modifiedby,
          created_at: data.created_at,
          updated_at: data.updated_at,
        });

        logData.push({
          ...data,
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
           shippinginstructiondetail_id = tmp.shippinginstructiondetail_id,
           shippinginstructiondetail_nobukti = tmp.shippinginstructiondetail_nobukti,
           orderanmuatan_nobukti = tmp.orderanmuatan_nobukti,
           comodity = tmp.comodity,
           keterangan = tmp.keterangan,
           modifiedby = tmp.modifiedby,
           created_at = tmp.created_at,
           updated_at = tmp.updated_at
         from "${tempTableName}" as tmp
         where t.id = tmp.id
         returning t.*`,
      );
      const updatedData = updatedResult?.rows?.[0] ?? null;

      const insertedDataQuery = await trx(tempTableName)
        .select([
          'nobukti',
          'shippinginstructiondetail_id',
          'shippinginstructiondetail_nobukti',
          'orderanmuatan_nobukti',
          'comodity',
          'keterangan',
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
          'u.shippinginstructiondetail_id',
          'u.shippinginstructiondetail_nobukti',
          'u.orderanmuatan_nobukti',
          'u.comodity',
          'u.keterangan',
          'u.modifiedby',
          'u.created_at',
          'u.updated_at',
        )
        .where('u.shippinginstructiondetail_id', shippinginstructiondetail_id)
        .modify(notInTemp);

      const pushToLogWithAction = getDeleted.map((entry: any) => ({
        ...entry,
        aksi: 'DELETE',
      }));

      const finalData = logData.concat(pushToLogWithAction);

      await trx(`${this.tableName} as u`)
        .where('u.shippinginstructiondetail_id', shippinginstructiondetail_id)
        .modify(notInTemp)
        .del();

      if (insertedDataQuery.length > 0) {
        insertedData = await trx(this.tableName)
          .insert(await withUuidV7(trx, insertedDataQuery))
          .returning('*')
          .then((result: any) => result[0]);
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD SHIPPING INSTRUCTION DETAIL RINCIAN',
          idtrans: shippinginstructiondetail_id,
          nobuktitrans: shippinginstructiondetail_id,
          aksi: 'EDIT',
          datajson: JSON.stringify(finalData),
          modifiedby: detailsrincian[0].modifiedby,
        },
        trx,
      );

      return updatedData || insertedData;
    } catch (error) {
      console.error(
        'Error process creating shipping instruction detail rincian in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process creating shipping instruction detail rincian in service',
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

      // Baca dari VIEW: nocontainer/noseal (orderanmuatan) dan shipper_nama
      // (shipper) sudah ikut di sana, jadi dua LEFT JOIN tidak dirakit ulang
      // tiap kali baris detail berganti.
      const query = trx(`${this.viewName} as p`)
        .select(
          'p.id',
          'p.nobukti',
          'p.shippinginstructiondetail_id',
          'p.shippinginstructiondetail_nobukti',
          'p.orderanmuatan_nobukti',
          'p.comodity',
          'p.keterangan',
          'p.nocontainer',
          'p.noseal',
          'p.shipper_nama',
        )
        .where('p.shippinginstructiondetail_id', id);

      const searchFields = Object.keys(filters || {}).filter(
        (k) => filters![k],
      );

      // ilike + tanpa escape '[' ala MSSQL — lihat catatan yang sama di
      // ShippingInstructionService.applyFilters.
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
        } else {
          query.orderBy(`p.${sort.sortBy}`, sortDirection);
        }
      }

      // SENGAJA tanpa limit/offset — alasan sama dengan detail: rincian ikut
      // terkirim saat simpan, dan yang tidak ada di payload akan dihapus.
      const result = await query;

      return {
        data: result,
      };
    } catch (error) {
      console.error(
        'Error to findAll Schedule detail rincian in service',
        error,
      );
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} shippingInstructionDetailRincian`;
  }

  update(
    id: number,
    updateShippingInstructionDetailRincianDto: UpdateShippingInstructionDetailRincianDto,
  ) {
    return `This action updates a #${id} shippingInstructionDetailRincian`;
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
          postingdari: 'DELETE SHIPPING INSTRUCTION DETAIL RINCIAN',
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
        'Error deleting data shipping instruction detail rincian in service:',
        error,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete data shipping instruction detail rincian in service',
      );
    }
  }
}
