import {
  Injectable,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { CreateShippingInstructionDetailRincianDto } from './dto/create-shipping-instruction-detail-rincian.dto';
import { UpdateShippingInstructionDetailRincianDto } from './dto/update-shipping-instruction-detail-rincian.dto';
import { withUuidV7, UtilsService } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class ShippingInstructionDetailRincianService {
  private readonly tableName: string = 'shippinginstructiondetailrincian';
  private readonly viewName: string = 'vshippinginstructiondetailrincian';

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}

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

        ['comodity', 'keterangan'].forEach((field) => {
          if (typeof data[field] === 'string') {
            data[field] = data[field].toUpperCase();
          }
        });

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
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process creating shipping instruction detail rincian in service',
      );
    }
  }

  /**
   * shippinginstructiondetail_id diturunkan ke
   * vshippinginstructiondetailrincian lewat GUC supaya join ke orderanmuatan &
   * shipper hanya kena baris satu detail, bukan seluruh isi tabel rincian.
   *
   * `set_config(..., true)` transaksi-lokal, jadi tidak bocor lewat pool.
   */
  private async setSessionContext(trx: any, id: string): Promise<void> {
    await trx.raw(
      `SELECT set_config('tas.si_shippinginstructiondetail_id', ?, true)`,
      [id ? String(id) : ''],
    );
  }

  private columnFor(key: string): string {
    return key === 'detail_nobukti'
      ? 'p.shippinginstructiondetail_nobukti'
      : `p.${key}`;
  }

  /**
   * Search global + filter per kolom. Dipisah dari findAll supaya COUNT dan
   * query data memakai penyaringan yang sama persis.
   */
  private applyFilters(
    qb: any,
    filters: Record<string, any> | undefined,
    search?: string,
  ): void {
    const searchFields = Object.keys(filters || {});

    if (search && searchFields.length > 0) {
      const sanitized = String(search).trim();
      qb.where((inner: any) => {
        searchFields.forEach((field) => {
          inner.orWhere(this.columnFor(field), 'ilike', `%${sanitized}%`);
        });
      });
    }

    Object.entries(filters || {}).forEach(([key, rawValue]) => {
      if (rawValue === null || rawValue === undefined || rawValue === '')
        return;

      qb.andWhere(this.columnFor(key), 'ilike', `%${String(rawValue)}%`);
    });
  }

  async findAll(
    id: string,
    trx: any,
    { search, filters, pagination, sort }: FindAllParams,
  ) {
    const { page = 1, limit = 0 } = pagination ?? {};

    if (!id) {
      // Bentuk balikan tetap lengkap supaya grid yang membaca
      // pagination.totalItems saat baris detail belum dipilih tidak menemukan
      // undefined lalu menghitung totalPages = NaN.
      return {
        status: false,
        message: 'No data found',
        data: [],
        total: 0,
        pagination: {
          currentPage: Number(page),
          totalPages: 0,
          totalItems: 0,
          itemsPerPage: Number(limit),
        },
      };
    }

    try {
      await this.setSessionContext(trx, id);

      // set_config di atas sudah memangkas view, tapi WHERE eksplisit TETAP
      // dipasang — alasan sama seperti di service detail: hasil endpoint ini
      // ikut jadi payload simpan, dan create() menghapus baris yang tidak ada
      // di payload. JANGAN dihapus dengan alasan "sudah ada di view".
      const scoped = (qb: any) => {
        qb.where('p.shippinginstructiondetail_id', id);
        this.applyFilters(qb, filters, search);
      };

      const countResult = await trx(`${this.viewName} as p`)
        .modify(scoped)
        .count('* as total')
        .first();
      const total = Number(countResult?.total ?? 0);

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
        .modify(scoped);

      // Urutan HARUS deterministik: tanpa itu offset/limit bisa memulangkan
      // baris yang sama di dua halaman berbeda saat grid menggeser window.
      const sortBy = sort?.sortBy || 'shippinginstructiondetail_nobukti';
      const sortDirection =
        String(sort?.sortDirection).toLowerCase() === 'desc' ? 'desc' : 'asc';
      const orderCol = this.columnFor(sortBy);

      query.orderBy(orderCol, sortDirection);
      if (orderCol !== 'p.id') {
        query.orderBy('p.id', 'asc');
      }

      // limit 0/undefined = ambil semua, dipakai findOne header saat form edit
      // memuat seluruh rincian satu detail sekaligus.
      if (Number(limit) > 0) {
        query.offset((Number(page) - 1) * Number(limit)).limit(Number(limit));
      }

      const data = await query;
      const totalPages =
        Number(limit) > 0 ? Math.ceil(total / Number(limit)) : 1;

      return {
        status: data.length > 0,
        message:
          data.length > 0
            ? 'Shipping instruction detail rincian data fetched successfully'
            : 'No data found',
        data,
        total,
        pagination: {
          currentPage: Number(page),
          totalPages,
          totalItems: total,
          itemsPerPage: Number(limit),
        },
      };
    } catch (error) {
      console.error(
        'Error to findAll shipping instruction detail rincian in service',
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
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete data shipping instruction detail rincian in service',
      );
    }
  }
}
