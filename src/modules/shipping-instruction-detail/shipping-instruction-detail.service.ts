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

  /**
   * shippinginstruction_id diturunkan ke vshippinginstructiondetail lewat GUC
   * supaya kelima LEFT JOIN referensi di view hanya kena baris satu bukti,
   * bukan seluruh isi tabel detail lalu disaring belakangan.
   *
   * `set_config(..., true)` transaksi-lokal, jadi tidak bocor lewat pool.
   */
  private async setSessionContext(trx: any, id: string): Promise<void> {
    await trx.raw(
      `SELECT set_config('tas.si_shippinginstruction_id', ?, true)`,
      [id ? String(id) : ''],
    );
  }

  private static readonly ALIASED_COLUMNS: Record<string, string> = {
    detail_nobukti: 'p.shippinginstructiondetail_nobukti',
    emkllain_text: 'p.emkllain_nama',
    containerpelayaran_text: 'p.containerpelayaran_nama',
    tujuankapal_text: 'p.tujuankapal_nama',
    daftarbl_text: 'p.daftarbl_nama',
    statuspisahbl_text: 'p.statuspisahbl_nama',
  };

  private columnFor(key: string): string {
    return (
      ShippingInstructionDetailService.ALIASED_COLUMNS[key] ?? `p.${key}`
    );
  }

  /**
   * Search global + filter per kolom. Dipisah dari findAll supaya COUNT dan
   * query data memakai penyaringan yang sama persis — kalau disalin, keduanya
   * langsung berbeda begitu salah satu diubah dan totalPages grid jadi ngawur.
   */
  private applyFilters(
    qb: any,
    filters: Record<string, any> | undefined,
    search?: string,
  ): void {
    // statuspisahbl_text disaring sebagai kecocokan id persis, bukan ilike,
    // jadi tidak ikut dalam pencarian global.
    const excludeSearchKeys = ['statuspisahbl_text'];
    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );

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

      const sanitizedValue = String(rawValue);
      if (key === 'statuspisahbl_text') {
        qb.andWhere('p.statuspisahbl', '=', sanitizedValue);
      } else {
        qb.andWhere(this.columnFor(key), 'ilike', `%${sanitizedValue}%`);
      }
    });
  }

  private sortColumn(sortBy?: string): string {
    return this.columnFor(sortBy || 'shippinginstructiondetail_nobukti');
  }

  async findAll(
    id: string,
    trx: any,
    { search, filters, pagination, sort }: FindAllParams,
  ) {
    const { page = 1, limit = 0 } = pagination ?? {};

    if (!id) {
      // Bentuk balikan tetap lengkap supaya grid yang membaca
      // pagination.totalItems saat header belum dipilih tidak menemukan
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
      // dipasang. Hasil endpoint ini dipakai FormShippingInstruction sebagai
      // payload simpan dan create() menghapus baris yang tidak ada di payload —
      // kalau session context gagal ter-set, tanpa WHERE ini detail milik bukti
      // lain ikut terbawa. JANGAN dihapus dengan alasan "sudah ada di view".
      const scoped = (qb: any) => {
        qb.where('p.shippinginstruction_id', id);
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
        .modify(scoped);

      // Urutan HARUS deterministik: tanpa itu offset/limit bisa memulangkan
      // baris yang sama di dua halaman berbeda (atau melewatkan baris) saat
      // grid menggeser window. Sort dari grid jadi primary, id (PK, unik)
      // sebagai tiebreaker supaya urutan total dan stabil.
      const sortBy = sort?.sortBy || 'shippinginstructiondetail_nobukti';
      const sortDirection =
        String(sort?.sortDirection).toLowerCase() === 'desc' ? 'desc' : 'asc';
      const orderCol = this.sortColumn(sortBy);

      query.orderBy(orderCol, sortDirection);
      if (orderCol !== 'p.id') {
        query.orderBy('p.id', 'asc');
      }

      // limit 0/undefined = ambil semua. Dipakai pemanggil non-grid yang butuh
      // seluruh detail satu bukti sekaligus (findOne header untuk form edit,
      // export/cetak).
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
            ? 'Shipping instruction detail data fetched successfully'
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
        'Error to findAll shipping instruction detail in service',
        error,
      );
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
