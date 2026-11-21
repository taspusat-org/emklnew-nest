import {
  Injectable,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { CreateEstimasiBiayaDetailInvoiceDto } from './dto/create-estimasi-biaya-detail-invoice.dto';
import { UpdateEstimasiBiayaDetailInvoiceDto } from './dto/update-estimasi-biaya-detail-invoice.dto';
import { withUuidV7, UtilsService } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class EstimasiBiayaDetailInvoiceService {
  private readonly tableName: string = 'estimasibiayadetailinvoice';
  // Tabel untuk TULIS, view untuk BACA — sama seperti bl-header/alatbayar.
  private readonly viewName: string = 'vestimasibiayadetailinvoice';

  // Grid mengirim key kolom saat sort (biayaemkl, link), sementara filter
  // mengirim '*_text'. 'nama' warisan era JOIN: dulu tanpa prefiks sehingga
  // nyangkut ke biayaemkl.nama; di view kolomnya bernama biayaemkl_nama.
  private readonly SORT_ALIAS: Record<string, string> = {
    nama: 'u.biayaemkl_nama',
    biayaemkl: 'u.biayaemkl_nama',
    biayaemkl_text: 'u.biayaemkl_nama',
    biayaemkl_nama: 'u.biayaemkl_nama',
    link: 'u.link_nama',
    link_text: 'u.link_nama',
    link_nama: 'u.link_nama',
  };

  private readonly SORT_COLUMNS = new Set([
    'nobukti',
    'estimasibiaya_id',
    'link_id',
    'biayaemkl_id',
    'nominal',
    'modifiedby',
    'created_at',
    'updated_at',
    'id',
  ]);

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
      // Tanpa prefiks '##' (global temp ala MSSQL): '#' bukan identifier valid
      // di Postgres saat direferensikan mentah, mis. trx.raw(`${temp}.kolom`).
      // Sama seperti BlDetailService.
      const tempTableName = `temp_${Math.random().toString(36).substring(2, 15)}`;
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

      // OPENJSON + jsonExtract adalah bentuk SQL Server. Padanannya di Postgres
      // jsonb_populate_recordset(null::<tabel>, ...): satu baris per elemen
      // array, kolom & tipenya mengikuti tabel base (temp dibuat dari
      // `SELECT * ... WHERE 1=0` sehingga bentuknya identik). Pola ini sudah
      // dipakai BlDetailService.
      await trx.raw(
        `insert into "${tempTableName}" select * from jsonb_populate_recordset(null::${this.tableName}, ?::jsonb)`,
        [jsonString],
      );

      // UPDATE ... FROM, bukan .join().update(). Bentuk join+update itu warisan
      // SQL Server; di Postgres knex MENGABAIKAN join-nya sehingga SQL yang
      // dihasilkan menyebut kolom temp tanpa klausa FROM dan gagal dengan
      // "missing FROM-clause entry for table temp_xxx" (SQLSTATE 42P01).
      const updatedResult = await trx.raw(
        `update ${this.tableName} as t set
           nobukti = tmp.nobukti,
           estimasibiaya_id = tmp.estimasibiaya_id,
           link_id = tmp.link_id,
           biayaemkl_id = tmp.biayaemkl_id,
           nominal = tmp.nominal,
           info = tmp.info,
           modifiedby = tmp.modifiedby,
           created_at = tmp.created_at,
           updated_at = tmp.updated_at
         from "${tempTableName}" as tmp
         where t.id = tmp.id
         returning t.*`,
      );
      const updatedData = updatedResult?.rows ?? [];

      // Handle insertion if no update occurs
      const insertedDataQuery = await trx(tempTableName)
        .select([
          'nobukti',
          'estimasibiaya_id',
          'link_id',
          'biayaemkl_id',
          'nominal',
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
              'Error inserting data estimasi biaya detail invoice:',
              error,
            );
            throw error;
          });
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD ESTIMASI BIAYA DETAIL INVOCE',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(finalData),
          modifiedby: details[0].modifiedby || 'unknown',
        },
        trx,
      );

      console.log(
        'RESULT ESTIMASI BIAYA DETAIL INVOICE insertedData',
        insertedData,
        'updatedData',
        updatedData,
      );

      return updatedData || insertedData;
    } catch (error) {
      console.error(
        'Error process creating estimasi biaya detail invoice in service:',
        error.message,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process creating estimasi biaya detail invoice in service',
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

      const query = trx(`${this.viewName} as u`)
        .select(
          'u.id',
          'u.nobukti',
          'u.estimasibiaya_id',
          'u.link_id',
          'u.biayaemkl_id',
          'u.nominal',
          'u.biayaemkl_nama',
          'u.link_nama',
        )
        .where('u.estimasibiaya_id', id);

      const excludeSearchKeys = ['test'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (search) {
        const sanitized = String(search).trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (field === 'biayaemkl_text') {
              qb.orWhere(`u.biayaemkl_nama`, 'ilike', `%${sanitized}%`);
            } else if (field === 'link_text') {
              qb.orWhere(`u.link_nama`, 'ilike', `%${sanitized}%`);
            } else {
              qb.orWhere(`u.${field}`, 'ilike', `%${sanitized}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value);
          if (value) {
            if (key === 'biayaemkl_text') {
              query.andWhere(
                `u.biayaemkl_nama`,
                'ilike',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'link_text') {
              query.andWhere(`u.link_nama`, 'ilike', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`u.${key}`, 'ilike', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        // Key di luar daftar (mis. kolom semu "nomor") jangan diteruskan ke
        // SQL — Postgres membalas 42703 dan grid ikut 500.
        const kolom =
          this.SORT_ALIAS[sort.sortBy] ??
          (this.SORT_COLUMNS.has(sort.sortBy) ? `u.${sort.sortBy}` : 'u.id');
        query.orderBy(kolom, sort.sortDirection);
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

  async findOne(id: string, trx: any = null) {
    try {
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id',
          'u.nobukti',
          'u.link_id',
          'u.biayaemkl_id',
          'u.nominal',
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
        'Error fetching data estimasi biaya detail invoice by id:',
        error,
      );
      throw new Error(
        'Failed to fetch data estimasi biaya detail invoice by id',
      );
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
          postingdari: 'DELETE ESTIMASI BIAYA DETAIL INVOICE',
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
        'Error deleting data estimasi biaya detail invoice in service:',
        error,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete data estimasi biaya detail invoice in service',
      );
    }
  }

  update(
    id: string,
    updateEstimasiBiayaDetailInvoiceDto: UpdateEstimasiBiayaDetailInvoiceDto,
  ) {
    return `This action updates a #${id} estimasiBiayaDetailInvoice`;
  }
}
