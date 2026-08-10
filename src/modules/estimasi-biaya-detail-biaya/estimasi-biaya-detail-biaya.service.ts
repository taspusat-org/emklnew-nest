import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateEstimasiBiayaDetailBiayaDto } from './dto/create-estimasi-biaya-detail-biaya.dto';
import { UpdateEstimasiBiayaDetailBiayaDto } from './dto/update-estimasi-biaya-detail-biaya.dto';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class EstimasiBiayaDetailBiayaService {
  private readonly tableName: string = 'estimasibiayadetailbiaya';

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}

  async create(details: any, id: any = 0, trx: any = null) {
    try {
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
        await trx(this.tableName).delete().where('estimasibiaya_id', id);
        return;
      }

      for (const data of details) {
        let isDataChanged = false;

        // Blanket-uppercase dihapus: tabel ini hanya punya kolom kunci (id,
        // estimasibiaya_id/link_id/biayaemkl_id FK) + numerik + info; tak ada
        // kolom teks manusiawi. Blanket uppercase meng-corrupt id/FK UUID
        // (case-sensitive) sehingga lookup-by-id gagal.

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

        mainDataToInsert.push(dataForInsert);
        logData.push({
          ...data,
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

      // **Update or Insert into 'packinglistdetailrincian' with correct idheader**
      const updatedData = await trx(this.tableName)
        .join(`${tempTableName}`, `${this.tableName}.id`, `${tempTableName}.id`)
        .update({
          nobukti: trx.raw(`${tempTableName}.nobukti`),
          estimasibiaya_id: trx.raw(`${tempTableName}.estimasibiaya_id`),
          link_id: trx.raw(`${tempTableName}.link_id`),
          biayaemkl_id: trx.raw(`${tempTableName}.biayaemkl_id`),
          nominal: trx.raw(`${tempTableName}.nominal`),
          nilaiasuransi: trx.raw(`${tempTableName}.nilaiasuransi`),
          nominaldisc: trx.raw(`${tempTableName}.nominaldisc`),
          nominalsebelumdisc: trx.raw(`${tempTableName}.nominalsebelumdisc`),
          nominaltradoluar: trx.raw(`${tempTableName}.nominaltradoluar`),
          info: trx.raw(`${tempTableName}.info`),
          modifiedby: trx.raw(`${tempTableName}.modifiedby`),
          created_at: trx.raw(`${tempTableName}.created_at`),
          updated_at: trx.raw(`${tempTableName}.updated_at`),
        })
        .returning('*')
        .then((result: any) => result[0])
        .catch((error: any) => {
          console.error(
            'Error updated data estimasi biaya detail biaya:',
            error,
          );
          throw error;
        });

      // Handle insertion if no update occurs
      const insertedDataQuery = await trx(tempTableName)
        .select([
          'nobukti',
          'estimasibiaya_id',
          'link_id',
          'biayaemkl_id',
          'nominal',
          'nilaiasuransi',
          'nominaldisc',
          'nominalsebelumdisc',
          'nominaltradoluar',
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
          'u.estimasibiaya_id',
          'u.link_id',
          'u.biayaemkl_id',
          'u.nominal',
          'u.nilaiasuransi',
          'u.nominaldisc',
          'u.nominalsebelumdisc',
          'u.nominaltradoluar',
          'u.info',
          'u.modifiedby',
          'u.created_at',
          'u.updated_at',
        )
        .whereNull(`${tempTableName}.id`)
        .where('u.estimasibiaya_id', id);

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
        .where(`${this.tableName}.estimasibiaya_id`, id)
        .del();

      if (insertedDataQuery.length > 0) {
        insertedData = await trx(this.tableName)
          .insert(await withUuidV7(trx, insertedDataQuery))
          .returning('*')
          .then((result: any) => result[0])
          .catch((error: any) => {
            console.error(
              'Error inserting data estimasi biaya detail biaya:',
              error,
            );
            throw error;
          });
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD ESTIMASI BIAYA DETAIL BIAYA',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(finalData),
          modifiedby: details[0].modifiedby || 'unknown',
        },
        trx,
      );

      console.log(
        'RESULT ESTIMASI BIAYA DETAIL BIAYA insertedData',
        insertedData,
        'updatedData',
        updatedData,
      );

      return updatedData || insertedData;
    } catch (error) {
      console.error(
        'Error process creating estimasi biaya detail biaya in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process creating estimasi biaya detail biaya in service',
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
          'u.estimasibiaya_id',
          'u.link_id',
          'u.biayaemkl_id',
          'u.nominal',
          'u.nilaiasuransi',
          'u.nominaldisc',
          'u.nominalsebelumdisc',
          'u.nominaltradoluar',
          'p.nama as biayaemkl_nama',
          'q.keterangan as link_nama',
        )
        .leftJoin('biayaemkl as p', 'u.biayaemkl_id', 'p.id')
        .leftJoin('hargatrucking as q', 'u.link_id', 'q.id')
        .where('estimasibiaya_id', id);

      const excludeSearchKeys = ['test'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (field === 'biayaemkl_text') {
              qb.orWhere(`p.nama`, 'like', `%${sanitized}%`);
            } else if (field === 'link_text') {
              qb.orWhere(`q.keterangan`, 'like', `%${sanitized}%`);
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
            } else if (key === 'link_text') {
              query.andWhere(`q.keterangan`, 'like', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'biayaemkl_text') {
          query.orderBy(`p.nama`, sort.sortDirection);
        } else if (sort?.sortBy === 'link_text') {
          query.orderBy(`q.keterangan`, sort.sortDirection);
        } else {
          query.orderBy(sort.sortBy, sort.sortDirection);
        }
      }

      const result = await query;
      console.log('RESULT DETAIL BIAYA', result);

      return {
        data: result,
      };
    } catch (error) {
      console.error(
        'Error to findAll estimasi biaya detail biaya in service',
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
          postingdari: 'DELETE ESTIMASI BIAYA DETAIL BIAYA',
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
        'Error deleting data estimasi biaya detail biaya in service:',
        error,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete data estimasi biaya detail biaya in service',
      );
    }
  }

  async findOne(id: string, trx: any) {
    try {
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id',
          'u.nobukti',
          'u.link_id',
          'u.biayaemkl_id',
          'u.nominal',
          'u.nilaiasuransi',
          'u.nominaldisc',
          'u.nominalsebelumdisc',
          'u.nominaltradoluar',
          'biayaemkl.nama as biayaemkl_nama',
          'hargatrucking.keterangan as link_nama',
        ])
        .leftJoin('biayaemkl', 'u.biayaemkl_id', 'biayaemkl.id')
        .leftJoin('hargatrucking', 'u.link_id', 'hargatrucking.id')
        .where('u.estimasibiaya_id', id);

      const data = await query;

      return data;
    } catch (error) {
      console.error(
        'Error fetching data estimasi biaya detail biaya by id:',
        error,
      );
      throw new Error('Failed to fetch data estimasi biaya detail biaya by id');
    }
  }

  update(
    id: number,
    updateEstimasiBiayaDetailBiayaDto: UpdateEstimasiBiayaDetailBiayaDto,
  ) {
    return `This action updates a #${id} estimasiBiayaDetailBiaya`;
  }
}
