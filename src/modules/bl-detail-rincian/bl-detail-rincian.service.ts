import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateBlDetailRincianDto } from './dto/create-bl-detail-rincian.dto';
import { UpdateBlDetailRincianDto } from './dto/update-bl-detail-rincian.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { BlDetailRincianBiayaService } from '../bl-detail-rincian-biaya/bl-detail-rincian-biaya.service';

@Injectable()
export class BlDetailRincianService {
  private readonly tableName: string = 'bldetailrincian';
  private readonly tableNameRincianBiaya: string = 'bldetailrincianbiaya';

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly blDetailRincianBiayaService: BlDetailRincianBiayaService,
  ) {}

  async create(details: any, id: any = 0, trx: any = null) {
    try {
      const allRincianBiaya: any[] = []; // Ambil semua data detail rincian biaya di luar mapping utama
      let insertedData = null;
      const logData: any[] = [];
      const mainDataToInsert: any[] = [];
      const time = this.utilsService.getTime();
      // Tanpa prefiks '##' (global temp ala MSSQL): '#' bukan identifier valid
      // di Postgres saat direferensikan mentah, mis. trx.raw(`${temp}.kolom`).
      // Sama seperti ShippingInstructionDetailService.
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

        // Uppercase hanya kolom teks manusiawi. id (PK), bldetail_id (FK), dan
        // *_nobukti adalah UUID/kunci bertipe text (case-sensitive); blanket
        // uppercase meng-corrupt id sehingga lookup-by-id gagal.
        ['keterangan'].forEach((field) => {
          if (typeof data[field] === 'string') {
            data[field] = data[field].toUpperCase();
          }
        });

        const { rincianbiaya, ...rincianWithOutBiaya } = data;

        // Extract dan simpan data rincian jika ada
        let tempRincianBiaya: any = {};
        if (rincianbiaya && rincianbiaya.length > 0) {
          tempRincianBiaya = {
            rincian: [...rincianbiaya], // Copy array rincian
          };
        }

        if (tempRincianBiaya) {
          allRincianBiaya.push(tempRincianBiaya);
        }

        // id kosong atau '0' = baris baru; pengirim antar-service memakai '0'.
        if (
          rincianWithOutBiaya.id &&
          String(rincianWithOutBiaya.id) !== '0'
        ) {
          const existingData = await trx(this.tableName)
            .where('id', rincianWithOutBiaya.id)
            .first();

          if (existingData) {
            const createdAt = {
              created_at: existingData.created_at,
              updated_at: existingData.updated_at,
            };
            Object.assign(rincianWithOutBiaya, createdAt);

            if (
              this.utilsService.hasChanges(rincianWithOutBiaya, existingData)
            ) {
              rincianWithOutBiaya.updated_at = time;
              isDataChanged = true;
              rincianWithOutBiaya.aksi = 'UPDATE';
            }
          }
        } else {
          // New record: Set timestamps
          const newTimestamps = {
            created_at: time,
            updated_at: time,
          };
          Object.assign(rincianWithOutBiaya, newTimestamps);
          isDataChanged = true;
          rincianWithOutBiaya.aksi = 'CREATE';
        }

        if (!isDataChanged) {
          rincianWithOutBiaya.aksi = 'NO UPDATE';
        }

        const { aksi, ...dataForInsert } = rincianWithOutBiaya;
        mainDataToInsert.push(dataForInsert);
        logData.push({
          ...rincianWithOutBiaya,
          created_at: time,
        });
      }

      await trx.raw(tableTemp);
      const jsonString = JSON.stringify(mainDataToInsert);
      // OPENJSON + jsonExtract adalah bentuk SQL Server. Padanannya di Postgres
      // jsonb_populate_recordset(null::<tabel>, ...): satu baris per elemen
      // array, kolom & tipenya mengikuti tabel base (temp dibuat dari
      // `SELECT * ... WHERE 1=0` sehingga bentuknya identik). Pola ini sudah
      // dipakai ShippingInstructionDetailService.
      await trx.raw(
        `insert into "${tempTableName}" select * from jsonb_populate_recordset(null::${this.tableName}, ?::jsonb)`,
        [jsonString],
      );

      // **Update or Insert into 'packinglistdetailrincian' with correct idheader**
      const updatedData = await trx(this.tableName)
        .join(`${tempTableName}`, `${this.tableName}.id`, `${tempTableName}.id`)
        .update({
          nobukti: trx.raw(`${tempTableName}.nobukti`),
          bldetail_id: trx.raw(`${tempTableName}.bldetail_id`),
          bldetail_nobukti: trx.raw(`${tempTableName}.bldetail_nobukti`),
          orderanmuatan_nobukti: trx.raw(
            `${tempTableName}.orderanmuatan_nobukti`,
          ),
          keterangan: trx.raw(`${tempTableName}.keterangan`),
          info: trx.raw(`${tempTableName}.info`),
          modifiedby: trx.raw(`${tempTableName}.modifiedby`),
          created_at: trx.raw(`${tempTableName}.created_at`),
          updated_at: trx.raw(`${tempTableName}.updated_at`),
        })
        .returning('*');

      // Handle insertion if no update occurs
      const insertedDataQuery = await trx(tempTableName)
        .select([
          'nobukti',
          'bldetail_id',
          'bldetail_nobukti',
          'orderanmuatan_nobukti',
          'keterangan',
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
          'u.keterangan',
          'u.info',
          'u.modifiedby',
          'u.created_at',
          'u.updated_at',
        )
        .whereNull(`${tempTableName}.id`)
        .where('u.bldetail_id', id);

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
        .where(`${this.tableName}.bldetail_id`, id)
        .del();

      if (insertedDataQuery.length > 0) {
        insertedData = await trx(this.tableName)
          .insert(await withUuidV7(trx, insertedDataQuery))
          .returning('*');
      }

      // PROSES DETAIL RINCIAN, Gabungkan detail yang sudah ada dengan yang baru diinsert
      const allDetailsRincian = [
        ...(updatedData || []),
        ...(insertedData || []),
      ];

      for (let i = 0; i < allRincianBiaya.length; i++) {
        // Map rincian dengan ID detail yang benar
        const rincianItem = allRincianBiaya[i];

        // Panggil service rincian jika ada data rincian
        if (rincianItem.rincian && rincianItem.rincian.length > 0) {
          // Tambahkan keperluan data lainnya ke setiap rincian
          const fixDataRincian = rincianItem.rincian.map((r: any) => ({
            ...r,
            bldetail_id: allDetailsRincian[i].bldetail_id,
            bldetail_nobukti: allDetailsRincian[i].bldetail_nobukti,
          }));

          await this.blDetailRincianBiayaService.create(
            fixDataRincian,
            id,
            trx,
          );
        }
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD BL DETAIL RINCIAN',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(finalData),
          modifiedby: details[0].modifiedby || 'unknown',
        },
        trx,
      );

      console.log(
        'RESULT RINCIAN insertedData',
        insertedData,
        'updatedData',
        updatedData,
      );

      return updatedData || insertedData;
    } catch (error) {
      console.error(
        'Error process creating bl detail rincian in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error process creating bl detail rincian in service',
      );
    }
  }

  /**
   * Nama kolom pivot untuk satu biaya EMKL. WAJIB dipakai di dua tempat —
   * pembuatan temp table di tempPivotBiaya() dan daftar select di findAll() —
   * supaya keduanya tidak pernah bergeser sendiri-sendiri.
   */
  private pivotColumnAlias(nama: string): string {
    const alias = String(nama)
      .replace(/\s+/g, '')
      .replace(/[^a-zA-Z0-9_]/g, '')
      .toLowerCase();

    return alias.startsWith('biaya') ? alias : `biaya${alias}`;
  }

  /**
   * Satu baris per (bldetail_id, orderanmuatan_nobukti) dengan SATU KOLOM per
   * biaya EMKL yang statusbiayabl = YA — dipakai findAll() sebagai sumber kolom
   * biaya di grid rincian.
   *
   * Versi lama memakai PIVOT + JSON_VALUE(A.[kolom], '$.nominal') + tiga temp
   * table ber-prefiks '##'. Ketiganya khusus SQL Server:
   *   - PIVOT tidak ada di Postgres,
   *   - JSON_VALUE dan kurung siku sebagai pembatas identifier juga tidak ada,
   *   - '##' bukan identifier valid saat direferensikan mentah.
   * Padanannya di Postgres adalah conditional aggregation
   * (MAX(CASE WHEN ... THEN ... END)), yang sekaligus menghapus kebutuhan
   * merakit lalu membongkar JSON: nominalnya diambil langsung dari kolomnya.
   *
   * Nama biaya EMKL ikut ke dalam SQL sebagai NILAI BIND (bukan literal yang
   * dirangkai), jadi tidak ada jalur injeksi lewat data master. Yang dirangkai
   * hanya nama kolom hasil, dan itu sudah dibersihkan pivotColumnAlias().
   */
  async tempPivotBiaya(trx: any) {
    try {
      const tempHasil = `temp_pivotbiaya_${Math.random()
        .toString(36)
        .substring(2, 15)}`;

      const getIdStatusYa = await trx('parameter')
        .select('id')
        .where('grp', 'STATUS NILAI')
        .where('text', 'YA')
        .first();

      const getBiayaEmkl = await trx('biayaemkl')
        .select('nama')
        .where('statusbiayabl', getIdStatusYa?.id ?? null);

      // Tidak ada biaya EMKL bertanda YA: tetap buat temp table (findAll
      // meng-LEFT JOIN-nya) dengan kolom kunci saja, tanpa kolom biaya.
      const kolomBiaya = getBiayaEmkl
        .map(
          (item: any) =>
            `MAX(CASE WHEN c.nama = ? THEN rb.nominal END) AS "${this.pivotColumnAlias(
              item.nama,
            )}"`,
        )
        .join(',\n               ');

      const bindNama = getBiayaEmkl.map((item: any) => item.nama);

      await trx.raw(
        `CREATE TEMP TABLE "${tempHasil}" AS
         SELECT a.bldetail_id,
                a.orderanmuatan_nobukti${kolomBiaya ? ',\n                ' + kolomBiaya : ''}
           FROM ${this.tableName} a
           LEFT JOIN ${this.tableNameRincianBiaya} rb
                  ON rb.orderanmuatan_nobukti = a.orderanmuatan_nobukti
           LEFT JOIN biayaemkl c
                  ON rb.biayaemkl_id = c.id
                 AND c.statusbiayabl = ?
          GROUP BY a.bldetail_id, a.orderanmuatan_nobukti`,
        [...bindNama, getIdStatusYa?.id ?? null],
      );

      return tempHasil;
    } catch (error) {
      console.error(
        'Error to create temp pivot rincian biaya in service:',
        error.message,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error to create temp pivot rincian biaya in service',
      );
    }
  }

  async findAll(
    id: number,
    trx: any,
    { search, filters, pagination, sort, isLookUp }: FindAllParams,
  ) {
    try {
      if (!id) {
        return {
          data: [],
        };
      }

      let { page, limit } = pagination ?? {};
      page = page ?? 1;
      limit = limit ?? 0;

      const getIdStatusYa = await trx('parameter')
        .select('id')
        .where('grp', 'STATUS NILAI')
        .where('text', 'YA')
        .first();
      const getBiayaEmkl = await trx('biayaemkl')
        .select('nama')
        .where('statusbiayabl', getIdStatusYa.id);
      const dataTempPivotBiaya = await this.tempPivotBiaya(trx);

      // BIKIN LOOPING DARI SEMUA NAMA BIAYA EMKL UNTUK SELECT HASIL JOIN DATATEMPPIVOTBIAYA
      // Nama kolom dihitung lewat helper yang SAMA dengan yang dipakai
      // tempPivotBiaya(), supaya select di sini tidak pernah menyimpang dari
      // kolom yang benar-benar dibuat di temp table.
      const selectColumnPivotBiaya = getBiayaEmkl.map(
        (item) => `p.${this.pivotColumnAlias(item.nama)}`,
      );
      // HAPUS TANDA p. didepan supaya sisa nama field kolom pivot tanpa "p." untuk dimanfaatkan buat kondisi search/filters/sorting
      const pivotFields = selectColumnPivotBiaya.map((c) =>
        c.replace('p.', ''),
      );

      const query = trx(`${this.tableName} as u`)
        .select(
          'u.id',
          'u.nobukti',
          'u.bldetail_id',
          'u.bldetail_nobukti',
          'u.orderanmuatan_nobukti',
          'u.keterangan',
          'q.nocontainer',
          'q.noseal',
          ...selectColumnPivotBiaya,
          // 'p.biayatruckingmuat',
          // 'p.biayadokumenbl',
          // 'p.biayaoperationalpelabuhan',
          // 'p.biayaseal'
        )
        .leftJoin(
          `${dataTempPivotBiaya} as p`,
          'u.orderanmuatan_nobukti',
          'p.orderanmuatan_nobukti',
        )
        .leftJoin('orderanmuatan as q', 'u.orderanmuatan_nobukti', 'q.nobukti')
        .where('u.bldetail_id', id);

      const excludeSearchKeys = [''];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (field === 'nocontainer' || field === 'noseal') {
              qb.orWhere(`q.${field}`, 'like', `%${sanitized}%`);
            } else if (pivotFields.includes(field)) {
              qb.orWhere(`p.${field}`, 'like', `%${sanitized}%`);
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
            if (key === 'nocontainer' || key === 'noseal') {
              query.andWhere(`q.${key}`, 'like', `%${sanitizedValue}%`);
            } else if (pivotFields.includes(key)) {
              query.andWhere(`p.${key}`, 'like', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'nocontainer' || sort?.sortBy === 'noseal') {
          query.orderBy(`q.${sort.sortBy}`, sort.sortDirection);
        } else if (pivotFields.includes(sort.sortBy)) {
          query.orderBy(`p.${sort.sortBy}`, sort.sortDirection);
        } else {
          query.orderBy(sort.sortBy, sort.sortDirection);
        }
      }

      const result = await query;

      return {
        data: result,
      };
    } catch (error) {
      console.error('Error to findAll Bl detail rincian in service', error);
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
          postingdari: 'DELETE BL DETAIL RINCIAN',
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
      console.log('Error deleting data bl detail rincian in service:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to delete data bl detail rincian in service',
      );
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} blDetailRincian`;
  }

  update(id: string, updateBlDetailRincianDto: UpdateBlDetailRincianDto) {
    return `This action updates a #${id} blDetailRincian`;
  }
}
