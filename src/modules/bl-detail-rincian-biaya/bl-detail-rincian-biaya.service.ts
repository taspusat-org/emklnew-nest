import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateBlDetailRincianBiayaDto } from './dto/create-bl-detail-rincian-biaya.dto';
import { UpdateBlDetailRincianBiayaDto } from './dto/update-bl-detail-rincian-biaya.dto';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class BlDetailRincianBiayaService {
  private readonly tableName: string = 'bldetailrincianbiaya';

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}

  async create(details: any, id: any = 0, trx: any = null) {
    try {
      console.log('MASUK DETAIL RINCIAN BIAYAAA', details);

      let insertedData = null;
      const logData: any[] = [];
      const mainDataToInsert: any[] = [];
      const time = this.utilsService.getTime();
      const orderanmuatan_nobukti = details[0].orderanmuatan_nobukti;
      // Tanpa prefiks '##' (global temp ala MSSQL). createTempTable() MEMBUANG
      // '#' saat membuat tabelnya (`CREATE TEMP TABLE "temp_xxx"`), jadi kalau
      // variabel ini masih membawa '##', setiap referensi setelahnya menunjuk
      // nama yang tidak pernah ada: `relation "##temp_xxx" does not exist`.
      // Sama seperti BlDetailService & ShippingInstructionDetailService.
      const tempTableName = `temp_${Math.random().toString(36).substring(2, 15)}`;
      const tableTemp = await this.utilsService.createTempTable(
        this.tableName,
        trx,
        tempTableName,
      );

      if (details.length === 0) {
        await trx(this.tableName).delete().where('bldetail_id', id);
        return;
      }

      for (const data of details) {
        let isDataChanged = false;
        // id kosong atau '0' = baris baru; pengirim antar-service memakai '0'.
        if (data.id && String(data.id) !== '0') {
          const existingData = await trx(this.tableName)
            .where('id', data.id)
            .first();

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
          }
        } else {
          // New record: Set timestamps
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

        const { aksi, ...dataForInsert } = data;
        console.log('aksi', aksi);

        mainDataToInsert.push(dataForInsert);
        logData.push({
          ...data,
          created_at: time,
        });
      }

      await trx.raw(tableTemp);

      const jsonString = JSON.stringify(mainDataToInsert);

      // OPENJSON + jsonExtract adalah bentuk SQL Server; di Postgres fungsinya
      // tidak ada ("function openjson(unknown) does not exist"). Padanannya
      // jsonb_populate_recordset(null::<tabel>, ...): satu baris per elemen
      // array, kolom & tipenya mengikuti tabel base — temp dibuat dari
      // `SELECT * ... WHERE 1=0` sehingga bentuknya identik. Pola yang sama
      // sudah dipakai BlDetailService, BlDetailRincianService, dan
      // ShippingInstructionDetailService.
      //
      // Bonus: tidak lagi membaca `mainDataToInsert[0]` untuk menyusun mapping,
      // yang berarti array kosong tidak lagi melempar TypeError.
      await trx.raw(
        `insert into "${tempTableName}" select * from jsonb_populate_recordset(null::${this.tableName}, ?::jsonb)`,
        [jsonString],
      );

      // **Update or Insert into 'packinglistdetailrincian' with correct idheader**
      // UPDATE ... FROM — alasannya sama dengan BlDetailService: di Postgres
      // knex mengabaikan join pada update sehingga temp table tidak pernah
      // masuk klausa FROM ("missing FROM-clause entry", SQLSTATE 42P01).
      const updatedResult = await trx
        .raw(
          `update ${this.tableName} as t set
             nobukti = tmp.nobukti,
             bldetail_id = tmp.bldetail_id,
             bldetail_nobukti = tmp.bldetail_nobukti,
             orderanmuatan_nobukti = tmp.orderanmuatan_nobukti,
             nominal = tmp.nominal,
             biayaemkl_id = tmp.biayaemkl_id,
             info = tmp.info,
             modifiedby = tmp.modifiedby,
             created_at = tmp.created_at,
             updated_at = tmp.updated_at
           from "${tempTableName}" as tmp
           where t.id = tmp.id
           returning t.*`,
        )
        .catch((error: any) => {
          console.error('Error updated data bl detail rincian biaya:', error);
          throw error;
        });
      // Pemanggil hanya memakai baris pertama (perilaku .then(result => result[0])
      // sebelumnya dipertahankan).
      const updatedData = updatedResult?.rows?.[0];

      // Handle insertion if no update occurs
      const insertedDataQuery = await trx(tempTableName)
        .select([
          'nobukti',
          'bldetail_id',
          'bldetail_nobukti',
          'orderanmuatan_nobukti',
          'nominal',
          'biayaemkl_id',
          'info',
          'modifiedby',
          'created_at',
          'updated_at',
        ])
        .where(`${tempTableName}.id`, '0');

      const getDeleted = await trx(`${this.tableName} as u`)
        .leftJoin(`${tempTableName}`, 'u.id', `${tempTableName}.id`)
        .select(
          'u.id',
          'u.nobukti',
          'u.bldetail_id',
          'u.bldetail_nobukti',
          'u.orderanmuatan_nobukti',
          'u.nominal',
          'u.biayaemkl_id',
          'u.info',
          'u.modifiedby',
          'u.created_at',
          'u.updated_at',
        )
        .whereNull(`${tempTableName}.id`)
        .where('u.bldetail_id', id)
        .where('u.orderanmuatan_nobukti', orderanmuatan_nobukti);

      let pushToLog: any[] = [];
      console.log('HEREE');

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
        .where(`${this.tableName}.bldetail_id`, id)
        .where(`${this.tableName}.orderanmuatan_nobukti`, orderanmuatan_nobukti)
        .del();

      if (insertedDataQuery.length > 0) {
        insertedData = await trx(this.tableName)
          .insert(await withUuidV7(trx, insertedDataQuery))
          .returning('*')
          .then((result: any) => result[0])
          .catch((error: any) => {
            console.error(
              'Error inserting data bl detail rincian biaya:',
              error,
            );
            throw error;
          });
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD BL DETAIL RINCIAN BIAYA',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(finalData),
          modifiedby: details[0].modifiedby || 'unknown',
        },
        trx,
      );

      console.log(
        'RESULT RINCIAN BIAYAAA insertedData',
        insertedData,
        'updatedData',
        updatedData,
      );

      return updatedData || insertedData;
    } catch (error) {
      console.error(
        'Error process creating bl detail rincian biaya in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process creating bl detail rincian biaya in service',
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
          'u.bldetail_id',
          'u.bldetail_nobukti',
          'u.orderanmuatan_nobukti',
          'nominal',
          'biayaemkl_id',
          'p.nama as biayaemkl_nama',
        )
        .leftJoin('biayaemkl as p', 'u.biayaemkl_id', 'p.id')
        .where('bldetail_id', id);

      const excludeSearchKeys = [''];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (field === 'biayaemkl_text') {
              qb.orWhere(`p.nama`, 'like', `%${sanitized}%`);
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
            if (key === 'biayaemkl_text') {
              query.andWhere(`p.nama`, 'like', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'biayaemkl') {
          query.orderBy(`p.nama`, sort.sortDirection);
        } else {
          query.orderBy(sort.sortBy, sort.sortDirection);
        }
      }

      const result = await query;

      return {
        data: result,
      };
    } catch (error) {
      console.error(
        'Error to findAll Bl detail rincian biaya in service',
        error,
      );
      throw new Error(error);
    }
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
          postingdari: 'DELETE BL DETAIL RINCIAN BIAYA',
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
        'Error deleting data bl detail rincian biaya in service:',
        error,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete data bl detail rincian biaya in service',
      );
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} blDetailRincianBiaya`;
  }

  update(
    id: number,
    updateBlDetailRincianBiayaDto: UpdateBlDetailRincianBiayaDto,
  ) {
    return `This action updates a #${id} blDetailRincianBiaya`;
  }
}
