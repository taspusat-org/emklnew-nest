import {
  Injectable,
  InternalServerErrorException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { CreatePackinglistdetailDto } from './dto/create-packinglistdetail.dto';
import { UpdatePackinglistdetailDto } from './dto/update-packinglistdetail.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { PackinglistdetailrincianService } from '../packinglistdetailrincian/packinglistdetailrincian.service';

@Injectable()
export class PackinglistdetailService {
  private readonly tableName = 'packinglistdetail';
  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly packinglistdetailrincianService: PackinglistdetailrincianService,
  ) {}
  private readonly logger = new Logger(PackinglistdetailService.name);
  async create(details: any, id: any = 0, trx: any = null) {
    const insertedData = null;
    let data: any = null;
    const tempTableName = `##temp_${Math.random().toString(36).substring(2, 15)}`;

    // Get the column info and create temporary table
    const result = await trx(this.tableName).columnInfo();
    const tableTemp = await this.utilsService.createTempTable(
      this.tableName,
      trx,
      tempTableName,
    );

    const time = this.utilsService.getTime();
    const logData: any[] = [];
    const mainDataToInsert: any[] = [];

    // Simpan data rincian untuk diproses nanti
    const rincianToProcess: any[] = [];

    if (details.length === 0) {
      await trx(this.tableName).delete().where('packinglist_id', id);
      return;
    }

    for (data of details) {
      let isDataChanged = false;

      // Extract dan simpan data rincian jika ada
      let tempRincian: any = {};
      if (data.rincian && data.rincian.length > 0) {
        tempRincian = {
          packinglistdetail_id: data.id || '0',
          rincian: [...data.rincian], // Copy array rincian
          modifiedby: data.modifiedby,
        };
      }

      // PENTING: Hapus field rincian SEBELUM proses apapun
      const { rincian, ...dataWithoutRincian } = data;
      data = dataWithoutRincian;

      // Simpan rincian data untuk diproses nanti
      if (tempRincian) {
        rincianToProcess.push(tempRincian);
      }

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

    // Create temporary table to insert
    await trx.raw(tableTemp);

    // Ensure each item has an idheader
    const processedData = mainDataToInsert.map((item: any) => {
      // DOUBLE CHECK: Pastikan tidak ada field rincian
      const { rincian, ...cleanItem } = item;
      return {
        ...cleanItem,
        packinglist_id: cleanItem.packinglist_id ?? id,
      };
    });

    // VALIDASI: Filter hanya column yang ada di database
    const validColumns = Object.keys(result);
    const cleanedProcessedData = processedData.map((item) => {
      const cleanItem: any = {};
      for (const key in item) {
        if (validColumns.includes(key)) {
          cleanItem[key] = item[key];
        }
      }
      return cleanItem;
    });

    const jsonString = JSON.stringify(cleanedProcessedData);
    const mappingData = Object.keys(cleanedProcessedData[0])
      .filter((key) => validColumns.includes(key)) // Filter hanya column valid
      .map((key) => ['value', `$.${key}`, key]);

    const openJson = await trx
      .from(trx.raw('OPENJSON(?)', [jsonString]))
      .jsonExtract(mappingData)
      .as('jsonData');

    // Insert into temp table
    await trx(tempTableName).insert(openJson);

    // Update existing records
    const updatedData = await trx('packinglistdetail')
      .join(`${tempTableName}`, 'packinglistdetail.id', `${tempTableName}.id`)
      .update({
        nobukti: trx.raw(`${tempTableName}.nobukti`),
        orderanmuatan_nobukti: trx.raw(
          `${tempTableName}.orderanmuatan_nobukti`,
        ),
        bongkarke: trx.raw(`${tempTableName}.bongkarke`),
        info: trx.raw(`${tempTableName}.info`),
        modifiedby: trx.raw(`${tempTableName}.modifiedby`),
        packinglist_id: trx.raw(`${tempTableName}.packinglist_id`),
        created_at: trx.raw(`${tempTableName}.created_at`),
        updated_at: trx.raw(`${tempTableName}.updated_at`),
      })
      .returning('*');

    // Handle insertion for new records
    const insertedDataQuery = await trx(tempTableName)
      .select([
        'nobukti',
        'orderanmuatan_nobukti',
        'bongkarke',
        'info',
        'modifiedby',
        trx.raw('? as packinglist_id', [id]),
        'created_at',
        'updated_at',
      ])
      .where(`${tempTableName}.id`, '0');

    // Get deleted records
    const getDeleted = await trx(this.tableName)
      .leftJoin(
        `${tempTableName}`,
        'packinglistdetail.id',
        `${tempTableName}.id`,
      )
      .select(
        'packinglistdetail.id',
        'packinglistdetail.nobukti',
        'packinglistdetail.orderanmuatan_nobukti',
        'packinglistdetail.bongkarke',
        'packinglistdetail.info',
        'packinglistdetail.modifiedby',
        'packinglistdetail.packinglist_id',
        'packinglistdetail.created_at',
        'packinglistdetail.updated_at',
      )
      .whereNull(`${tempTableName}.id`)
      .where('packinglistdetail.packinglist_id', id);

    let pushToLog: any[] = [];
    if (getDeleted.length > 0) {
      pushToLog = Object.assign(getDeleted, { aksi: 'DELETE' });
    }

    const pushToLogWithAction = pushToLog.map((entry) => ({
      ...entry,
      aksi: 'DELETE',
    }));

    const finalData = logData.concat(pushToLogWithAction);

    // Delete records not in temp table
    const deletedData = await trx(this.tableName)
      .leftJoin(
        `${tempTableName}`,
        'packinglistdetail.id',
        `${tempTableName}.id`,
      )
      .whereNull(`${tempTableName}.id`)
      .where('packinglistdetail.packinglist_id', id)
      .del();

    // Insert new records
    let newlyInsertedDetails = [];
    if (insertedDataQuery.length > 0) {
      newlyInsertedDetails = await trx('packinglistdetail')
        .insert(await withUuidV7(trx, insertedDataQuery))
        .returning('*');
    }

    // PROSES DETAIL RINCIAN
    // Gabungkan detail yang sudah ada dengan yang baru diinsert
    const allDetails = [
      ...(updatedData || []),
      ...(newlyInsertedDetails || []),
    ];

    // Map rincian dengan ID detail yang benar
    for (let i = 0; i < rincianToProcess.length; i++) {
      const rincianItem = rincianToProcess[i];

      // Jika packinglistdetail_id masih penanda baris baru, ambil ID hasil insert
      if (String(rincianItem.packinglistdetail_id) === '0' && allDetails[i]) {
        rincianItem.packinglistdetail_id = allDetails[i].id;
      }

      // Panggil service rincian jika ada data rincian
      if (rincianItem.rincian && rincianItem.rincian.length > 0) {
        // Tambahkan modifiedby ke setiap rincian
        const rincianWithModifiedBy = rincianItem.rincian.map((r: any) => ({
          ...r,
          modifiedby: rincianItem.modifiedby,
        }));
        console.log(rincianWithModifiedBy, 'rincianWithModifiedBy');
        // Panggil service packinglistdetailrincian
        await this.packinglistdetailrincianService.create(
          rincianWithModifiedBy,
          rincianItem.packinglistdetail_id,
          trx,
        );
      }
    }

    // Log trail
    await this.logTrailService.create(
      {
        namatabel: this.tableName,
        postingdari: 'PACKING LIST DETAIL',
        idtrans: id,
        nobuktitrans: id,
        aksi: 'EDIT',
        datajson: JSON.stringify(finalData),
        modifiedby: details[0].modifiedby || 'unknown',
      },
      trx,
    );

    return updatedData || newlyInsertedDetails;
  }
  async findAll({ search, filters, sort }: FindAllParams, trx: any) {
    if (!filters?.nobukti) {
      return {
        data: [],
      };
    }
    // const tempUrl = `##temp_url_${Math.random().toString(36).substring(2, 8)}`;

    // await trx.schema.createTable(tempUrl, (t) => {
    //   t.integer('id').nullable();
    //   t.string('nobukti').nullable();
    //   t.text('link').nullable();
    // });
    // const url = 'jurnalumumheader';

    // await trx(tempUrl).insert(
    //   trx
    //     .select(
    //       'u.id',
    //       'u.nobukti',
    //       trx.raw(`
    //         STRING_AGG(
    //           '<a target="_blank" className="link-color" href="/dashboard/${url}' + ${tandatanya} + 'nobukti=' + u.nobukti + '">' +
    //           '<HighlightWrapper value="' + u.nobukti + '" />' +
    //           '</a>', ','
    //         ) AS link
    //       `),
    //     )
    //     .from(this.tableName + ' as u')
    //     .groupBy('u.id', 'u.nobukti'),
    // );

    try {
      if (!filters?.nobukti) {
        return {
          status: true,
          message: 'Jurnal umum Detail failed to fetch',
          data: [],
        };
      }
      const query = trx
        .from(trx.raw(`${this.tableName} as p`))
        .select(
          'p.id',
          'p.packinglist_id',
          'p.nobukti',
          'p.orderanmuatan_nobukti',
          'p.bongkarke',
          'p.info',
          'p.modifiedby',
          trx.raw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
        )
        .orderBy('p.created_at', 'desc');

      if (filters?.nobukti) {
        query.where('p.nobukti', filters?.nobukti);
      }
      const excludeSearchKeys = ['nobukti'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k) && filters![k],
      );
      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            qb.orWhere(`p.${field}`, 'like', `%${sanitized}%`);
          });
        });
      }
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (key === 'packinglist_id') {
            continue;
          }
          if (!value) continue;
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          switch (key) {
            case 'bongkarke':
              query.andWhere('p.bongkarke', 'like', `%${sanitizedValue}%`);
              break;

            default:
              query.andWhere(`p.${key}`, 'like', `%${sanitizedValue}%`);
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }
      const result = await query;
      return {
        data: result,
      };
    } catch (error) {
      console.error('Error in findAll Packinglist Detail', error);
      throw new Error(error);
    }
  }
  async delete(id: string, trx: any, modifiedby: string) {
    try {
      const dataDetail = await trx('packinglistdetail').where(
        'packinglist_id',
        id,
      );

      if (dataDetail.length === 0) {
        return {
          status: 200,
          message: 'Data not found',
          data: [],
        };
      }
      const deletedData: any = [];
      for (const item of dataDetail) {
        const deletedDataItem = await this.utilsService.lockAndDestroy(
          item.id,
          this.tableName,
          'id',
          trx,
        );
        deletedData.push(deletedDataItem);
        await this.packinglistdetailrincianService.delete(
          item.id,
          trx,
          modifiedby,
        );
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE PACKING LIST DETAIL',
          idtrans: deletedData.id,
          nobuktitrans: deletedData.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby,
        },
        trx,
      );

      return { status: 200, message: 'Data deleted successfully', deletedData };
    } catch (error) {
      console.log('Error deleting data:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }
  findOne(id: string) {
    return `This action returns a #${id} packinglistdetail`;
  }

  update(id: string, updatePackinglistdetailDto: UpdatePackinglistdetailDto) {
    return `This action updates a #${id} packinglistdetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} packinglistdetail`;
  }
}
