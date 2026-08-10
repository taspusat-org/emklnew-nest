import { Injectable, Logger } from '@nestjs/common';
import { CreatePengembaliankasgantungdetailDto } from './dto/create-pengembaliankasgantungdetail.dto';
import { UpdatePengembaliankasgantungdetailDto } from './dto/update-pengembaliankasgantungdetail.dto';
import { dbBunga } from 'src/common/utils/db';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class PengembaliankasgantungdetailService {
  private readonly tableName = 'pengembaliankasgantungdetail';
  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  private readonly logger = new Logger(
    PengembaliankasgantungdetailService.name,
  );
  async create(details: any, id: any = 0, trx: any = null) {
    let insertedData = null;
    let data: any = null;
    const tempTableName = `##temp_${Math.random().toString(36).substring(2, 15)}`;
    try {
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
      if (details.length === 0) {
        await trx(this.tableName)
          .delete()
          .where('pengembaliankasgantung_id', id);
        return;
      }
      for (data of details) {
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
        mainDataToInsert.push(dataForInsert);
        logData.push({
          ...data,
          created_at: time,
        });
      }

      // Create temporary table to insert
      await trx.raw(tableTemp);
      // Ensure each item has an idheader
      const processedData = mainDataToInsert.map((item: any) => ({
        ...item,
        pengembaliankasgantung_id: item.pengembaliankasgantung_id ?? id, // Ensure correct field mapping
      }));
      const jsonString = JSON.stringify(processedData);

      const mappingData = Object.keys(processedData[0]).map((key) => [
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

      // **Update or Insert into 'pengembaliankasgantungdetail' with correct idheader**
      const updatedData = await trx('pengembaliankasgantungdetail')
        .join(
          `${tempTableName}`,
          'pengembaliankasgantungdetail.id',
          `${tempTableName}.id`,
        )
        .update({
          nobukti: trx.raw(`${tempTableName}.nobukti`),
          kasgantung_nobukti: trx.raw(`${tempTableName}.kasgantung_nobukti`),
          keterangan: trx.raw(`${tempTableName}.keterangan`),
          nominal: trx.raw(`${tempTableName}.nominal`),
          info: trx.raw(`${tempTableName}.info`),
          modifiedby: trx.raw(`${tempTableName}.modifiedby`),
          editing_by: trx.raw(`${tempTableName}.editing_by`),
          editing_at: trx.raw(`${tempTableName}.editing_at`),
          pengembaliankasgantung_id: trx.raw(
            `${tempTableName}.pengembaliankasgantung_id`,
          ),
          penerimaandetail_id: trx.raw(`${tempTableName}.penerimaandetail_id`),
          created_at: trx.raw(`${tempTableName}.created_at`),
          updated_at: trx.raw(`${tempTableName}.updated_at`),
        })
        .returning('*')
        .then((result: any) => result[0])
        .catch((error: any) => {
          console.error('Error inserting data:', error);
          throw error;
        });

      // Handle insertion if no update occurs
      const insertedDataQuery = await trx(tempTableName)
        .select([
          'nobukti',
          'kasgantung_nobukti',
          'keterangan',
          'nominal',
          'info',
          'modifiedby',
          'editing_by',
          'editing_at',
          trx.raw('? as pengembaliankasgantung_id', [id]),
          'penerimaandetail_id',
          'created_at',
          'updated_at',
        ])
        .where(`${tempTableName}.id`, '0');

      const getDeleted = await trx(this.tableName)
        .leftJoin(
          `${tempTableName}`,
          'pengembaliankasgantungdetail.id',
          `${tempTableName}.id`,
        )
        .select(
          'pengembaliankasgantungdetail.id',
          'pengembaliankasgantungdetail.nobukti',
          'pengembaliankasgantungdetail.kasgantung_nobukti',
          'pengembaliankasgantungdetail.keterangan',
          'pengembaliankasgantungdetail.nominal',
          'pengembaliankasgantungdetail.info',
          'pengembaliankasgantungdetail.modifiedby',
          'pengembaliankasgantungdetail.editing_by',
          'pengembaliankasgantungdetail.editing_at',
          'pengembaliankasgantungdetail.penerimaandetail_id',
          'pengembaliankasgantungdetail.created_at',
          'pengembaliankasgantungdetail.updated_at',
          'pengembaliankasgantungdetail.pengembaliankasgantung_id',
        )
        .whereNull(`${tempTableName}.id`)
        .where('pengembaliankasgantungdetail.pengembaliankasgantung_id', id);

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
          'pengembaliankasgantungdetail.id',
          `${tempTableName}.id`,
        )
        .whereNull(`${tempTableName}.id`)
        .where('pengembaliankasgantungdetail.pengembaliankasgantung_id', id)
        .del();
      if (insertedDataQuery.length > 0) {
        insertedData = await trx('pengembaliankasgantungdetail')
          .insert(await withUuidV7(trx, insertedDataQuery))
          .returning('*')
          .then((result: any) => result[0])
          .catch((error: any) => {
            console.error('Error inserting data:', error);
            throw error;
          });
      }

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'PENGEMBALIAN KAS GANTUNG HEADER',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(finalData),
          modifiedby: details[0].modifiedby || 'unknown',
        },
        trx,
      );

      return updatedData || insertedData;
    } catch (error) {
      console.error('Error in create function:', error);
      throw error; // Re-throw the error after logging it
    }
  }

  async findAll({ search, filters, sort }: FindAllParams, trx: any) {
    if (!filters?.nobukti) {
      return {
        data: [],
      };
    }
    const query = trx(`${this.tableName} as p`).select(
      'p.id',
      'p.pengembaliankasgantung_id',
      'p.nobukti',
      'p.kasgantung_nobukti',
      'p.keterangan',
      'p.nominal',
      'p.info',
      'p.modifiedby',
      'p.penerimaandetail_id',
      trx.raw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
      trx.raw("TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
    );

    if (filters?.nobukti) {
      query.where('p.nobukti', filters?.nobukti);
    }
    const excludeSearchKeys = ['tglDari', 'tglSampai', 'nobukti'];
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
        const sanitizedValue = String(value).replace(/\[/g, '[[]');

        if (value) {
          if (key === 'created_at' || key === 'updated_at') {
            query.andWhereRaw("TO_CHAR(p.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
              key,
              `%${sanitizedValue}%`,
            ]);
          } else {
            query.andWhere(`p.${key}`, 'like', `%${sanitizedValue}%`);
          }
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
  }

  async tes(tgldari: string, tglsampai: string) {
    const formatDate = (dateString) => {
      const date = new Date(dateString);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0'); // Tambahkan 1 karena bulan di JavaScript dimulai dari 0
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const formattedTglDari = formatDate(tgldari);
    const formattedTglSampai = formatDate(tglsampai);

    const tempTableName = `cuti_approval_cache_${Date.now()}`;
    const tempsuratpengantar1 = `tempsuratpengantar1${Date.now()}`;
    // await dbBunga.schema.createTable(tempsuratpengantar1, (table) => {
    //   table.integer('id').nullable();
    // });
    // await dbBunga(tempsuratpengantar1).insert(
    //   dbBunga('suratpengantar as u').select('u.id'),
    // );
    // Membuat tabel sementara
    await dbBunga.schema.createTable(tempTableName, (table) => {
      table.integer('id').nullable();
      table.integer('idoriginal').nullable();
      table.string('jobtrucking', 50).nullable();
      table.string('nobukti', 50).nullable();
      table.string('tglbukti').nullable();
      table.string('nosp', 50).nullable();
      table.string('tglsp').nullable();
      table.string('nojob', 50).nullable();
      table.string('pelanggan_id').nullable();
      table.text('keterangan').nullable();
      table.string('dari_id').nullable();
      table.string('sampai_id').nullable();
      table.decimal('gajisupir', 15, 2).nullable();
      table.decimal('jarak', 15, 2).nullable();
      table.text('penyesuaian').nullable();
      table.string('agen_id').nullable();
      table.string('jenisorder_id').nullable();
      table.string('container_id').nullable();
      table.string('nocont').nullable();
      table.string('noseal').nullable();
      table.string('statuscontainer_id').nullable();
      table.string('gudang').nullable();
      table.string('trado_id').nullable();
      table.string('gandengan_id').nullable();
      table.text('statuslongtrip').nullable();
      table.text('statuslongtriptext').nullable();
      table.text('statusperalihan').nullable();
      table.text('statusperalihantext').nullable();
      table.text('statusritasiomset').nullable();
      table.text('statusapprovalmandor').nullable();
      table.text('statusapprovalmandortext').nullable();
      table.string('tglapprovalmandor').nullable();
      table.string('userapprovalmandor').nullable();
      table.string('tarif_id').nullable();
      table.string('mandortrado_id').nullable();
      table.string('mandorsupir_id').nullable();
      table.text('statusgudangsama').nullable();
      table.text('statusgudangsamatext').nullable();
      table.text('statusbatalmuat').nullable();
      table.text('statusbatalmuattext').nullable();
      table.string('modifiedby').nullable();
      table.string('created_at').nullable();
      table.string('updated_at').nullable();
      table.integer('flag').nullable();
    });
    // Gunakan insert dengan select langsung
    const query = await dbBunga.raw(
      `
        INSERT INTO ?? 
        SELECT 
          [u].[id], 
          [u].[id] AS [idoriginal], 
          [u].[jobtrucking], 
          [u].[nobukti], 
          [u].[tglbukti], 
          [u].[nosp], 
          [u].[tglsp], 
          [u].[nojob], 
          [p].[namapelanggan] AS [pelanggan_id], 
          [u].[keterangan], 
          [kd].[kodekota] AS [dari_id], 
          [ks].[kodekota] AS [sampai_id], 
          [u].[gajisupir], 
          [u].[jarak], 
          [u].[penyesuaian], 
          [a].[namaagen] AS [agen_id], 
          [jo].[keterangan] AS [jenisorder_id], 
          [c].[keterangan] AS [container_id], 
          [u].[nocont], 
          [u].[noseal], 
          [sc].[keterangan] AS [statuscontainer_id], 
          [u].[gudang], 
          [t].[kodetrado] AS [trado_id], 
          [g].[keterangan] AS [gandengan_id], 
          [sl].[memo] AS [statuslongtrip], 
          [sl].[text] AS [statuslongtriptext], 
          [sp].[memo] AS [statusperalihan], 
          [sp].[text] AS [statusperalihantext], 
          [sro].[memo] AS [statusritasiomset], 
          [sam].[memo] AS [statusapprovalmandor], 
          [sam].[text] AS [statusapprovalmandortext], 
          (CASE 
            WHEN (YEAR([u].[tglapprovalmandor]) <= 2000) 
            THEN NULL 
            ELSE [u].[tglapprovalmandor] 
          END) AS [tglapprovalmandor], 
          [u].[userapprovalmandor], 
          [ta].[tujuan] AS [tarif_id], 
          [mt].[namamandor] AS [mandortrado_id], 
          [ms].[namamandor] AS [mandorsupir_id], 
          [sg].[memo] AS [statusgudangsama], 
          [sg].[text] AS [statusgudangsamatext], 
          [sb].[memo] AS [statusbatalmuat], 
          [sb].[text] AS [statusbatalmuattext], 
          [u].[modifiedby], 
          [u].[created_at], 
          [u].[updated_at], 
          1 AS [flag] 
        FROM [suratpengantar] AS [u] 
        LEFT JOIN [pelanggan] AS [p] ON [u].[pelanggan_id] = [p].[id] 
        LEFT JOIN [kota] AS [kd] ON [kd].[id] = [u].[dari_id] 
        LEFT JOIN [kota] AS [ks] ON [ks].[id] = [u].[sampai_id] 
        LEFT JOIN [agen] AS [a] ON [u].[agen_id] = [a].[id] 
        LEFT JOIN [jenisorder] AS [jo] ON [u].[jenisorder_id] = [jo].[id] 
        LEFT JOIN [container] AS [c] ON [u].[container_id] = [c].[id] 
        LEFT JOIN [statuscontainer] AS [sc] ON [u].[statuscontainer_id] = [sc].[id] 
        LEFT JOIN [trado] AS [t] ON [u].[trado_id] = [t].[id] 
        LEFT JOIN [supir] AS [s] ON [u].[supir_id] = [s].[id] 
        LEFT JOIN [gandengan] AS [g] ON [u].[gandengan_id] = [g].[id] 
        LEFT JOIN [parameter] AS [sl] ON [u].[statuslongtrip] = [sl].[id] 
        LEFT JOIN [parameter] AS [sp] ON [u].[statusperalihan] = [sp].[id] 
        LEFT JOIN [parameter] AS [sro] ON [u].[statusritasiomset] = [sro].[id] 
        LEFT JOIN [parameter] AS [sg] ON [u].[statusgudangsama] = [sg].[id] 
        LEFT JOIN [parameter] AS [sb] ON [u].[statusbatalmuat] = [sb].[id] 
        LEFT JOIN [parameter] AS [sam] ON [u].[statusapprovalmandor] = [sam].[id] 
        LEFT JOIN [mandor] AS [mt] ON [u].[mandortrado_id] = [mt].[id] 
        LEFT JOIN [mandor] AS [ms] ON [u].[mandorsupir_id] = [ms].[id] 
        LEFT JOIN [tarif] AS [ta] ON [u].[tarif_id] = [ta].[id] 
        WHERE [u].[tglbukti] BETWEEN ? AND ?
      `,
      [tempTableName, formattedTglDari, formattedTglSampai],
    );

    // (tempTableName).insert(
    //   dbBunga('suratpengantar as u')
    //     .select(
    //       'u.id',
    //       'u.id as idoriginal',
    //       'u.jobtrucking',
    //       'u.nobukti',
    //       'u.tglbukti',
    //       'u.nosp',
    //       'u.tglsp',
    //       'u.nojob',
    //       'p.namapelanggan as pelanggan_id',
    //       'u.keterangan',
    //       'kd.kodekota as dari_id',
    //       'ks.kodekota as sampai_id',
    //       'u.gajisupir',
    //       'u.jarak',
    //       'u.penyesuaian',
    //       'a.namaagen as agen_id',
    //       'jo.keterangan as jenisorder_id',
    //       'c.keterangan as container_id',
    //       'u.nocont',
    //       'u.noseal',
    //       'sc.keterangan as statuscontainer_id',
    //       'u.gudang',
    //       't.kodetrado as trado_id',
    //       'g.keterangan as gandengan_id',
    //       'sl.memo as statuslongtrip',
    //       'sl.text as statuslongtriptext',
    //       'sp.memo as statusperalihan',
    //       'sp.text as statusperalihantext',
    //       'sro.memo as statusritasiomset',
    //       'sam.memo as statusapprovalmandor',
    //       'sam.text as statusapprovalmandortext',
    //       dbBunga.raw(
    //         '(case when (year(u.tglapprovalmandor) <= 2000) then null else u.tglapprovalmandor end ) as tglapprovalmandor',
    //       ),
    //       'u.userapprovalmandor',
    //       'ta.tujuan as tarif_id',
    //       'mt.namamandor as mandortrado_id',
    //       'ms.namamandor as mandorsupir_id',
    //       'sg.memo as statusgudangsama',
    //       'sg.text as statusgudangsamatext',
    //       'sb.memo as statusbatalmuat',
    //       'sb.text as statusbatalmuattext',
    //       'u.modifiedby',
    //       'u.created_at',
    //       'u.updated_at',
    //       dbBunga.raw('1 as flag'),
    //     )
    //     .whereBetween('u.tglbukti', [formattedTglDari, formattedTglSampai])
    //     .leftJoin('pelanggan as p', 'u.pelanggan_id', 'p.id')
    //     .leftJoin('kota as kd', 'kd.id', '=', 'u.dari_id')
    //     .leftJoin('kota as ks', 'ks.id', '=', 'u.sampai_id')
    //     .leftJoin('agen as a', 'u.agen_id', 'a.id')
    //     .leftJoin('jenisorder as jo', 'u.jenisorder_id', 'jo.id')
    //     .leftJoin('container as c', 'u.container_id', 'c.id')
    //     .leftJoin('statuscontainer as sc', 'u.statuscontainer_id', 'sc.id')
    //     .leftJoin('trado as t', 'u.trado_id', 't.id')
    //     .leftJoin('supir as s', 'u.supir_id', 's.id')
    //     .leftJoin('gandengan as g', 'u.gandengan_id', 'g.id')
    //     .leftJoin('parameter as sl', 'u.statuslongtrip', 'sl.id')
    //     .leftJoin('parameter as sp', 'u.statusperalihan', 'sp.id')
    //     .leftJoin('parameter as sro', 'u.statusritasiomset', 'sro.id')
    //     .leftJoin('parameter as sg', 'u.statusgudangsama', 'sg.id')
    //     .leftJoin('parameter as sb', 'u.statusbatalmuat', 'sb.id')
    //     .leftJoin('parameter as sam', 'u.statusapprovalmandor', 'sam.id')
    //     .leftJoin('mandor as mt', 'u.mandortrado_id', 'mt.id')
    //     .leftJoin('mandor as ms', 'u.mandorsupir_id', 'ms.id')
    //     .leftJoin('tarif as ta', 'u.tarif_id', 'ta.id'),
    // );
    // .join(`${tempsuratpengantar1} as sp1`, 'u.id', 'sp1.id');

    // const query = await dbBunga('suratpengantar as u')
    // .select(
    //   'u.id',
    //   'u.id as idoriginal',
    //   'u.jobtrucking',
    //   'u.nobukti',
    //   'u.tglbukti',
    //   'u.nosp',
    //   'u.tglsp',
    //   'u.nojob',
    //   'p.namapelanggan as pelanggan_id',
    //   'u.keterangan',
    //   'kd.kodekota as dari_id',
    //   'ks.kodekota as sampai_id',
    //   'u.gajisupir',
    //   'u.jarak',
    //   'u.penyesuaian',
    //   'a.namaagen as agen_id',
    //   'jo.keterangan as jenisorder_id',
    //   'c.keterangan as container_id',
    //   'u.nocont',
    //   'u.noseal',
    //   'sc.keterangan as statuscontainer_id',
    //   'u.gudang',
    //   't.kodetrado as trado_id',
    //   'g.keterangan as gandengan_id',
    //   'sl.memo as statuslongtrip',
    //   'sl.text as statuslongtriptext',
    //   'sp.memo as statusperalihan',
    //   'sp.text as statusperalihantext',
    //   'sro.memo as statusritasiomset',
    //   'sam.memo as statusapprovalmandor',
    //   'sam.text as statusapprovalmandortext',
    //   dbBunga.raw(
    //     '(case when (year(u.tglapprovalmandor) <= 2000) then null else u.tglapprovalmandor end ) as tglapprovalmandor',
    //   ),
    //   'u.userapprovalmandor',
    //   'ta.tujuan as tarif_id',
    //   'mt.namamandor as mandortrado_id',
    //   'ms.namamandor as mandorsupir_id',
    //   'sg.memo as statusgudangsama',
    //   'sg.text as statusgudangsamatext',
    //   'sb.memo as statusbatalmuat',
    //   'sb.text as statusbatalmuattext',
    //   'u.modifiedby',
    //   'u.created_at',
    //   'u.updated_at',
    //   dbBunga.raw('1 as flag'),
    // )
    // .whereBetween('u.tglbukti', [formattedTglDari, formattedTglSampai])
    // .leftJoin('pelanggan as p', 'u.pelanggan_id', 'p.id')
    // .leftJoin('kota as kd', 'kd.id', '=', 'u.dari_id')
    // .leftJoin('kota as ks', 'ks.id', '=', 'u.sampai_id')
    // .leftJoin('agen as a', 'u.agen_id', 'a.id')
    // .leftJoin('jenisorder as jo', 'u.jenisorder_id', 'jo.id')
    // .leftJoin('container as c', 'u.container_id', 'c.id')
    // .leftJoin('statuscontainer as sc', 'u.statuscontainer_id', 'sc.id')
    // .leftJoin('trado as t', 'u.trado_id', 't.id')
    // .leftJoin('supir as s', 'u.supir_id', 's.id')
    // .leftJoin('gandengan as g', 'u.gandengan_id', 'g.id')
    // .leftJoin('parameter as sl', 'u.statuslongtrip', 'sl.id')
    // .leftJoin('parameter as sp', 'u.statusperalihan', 'sp.id')
    // .leftJoin('parameter as sro', 'u.statusritasiomset', 'sro.id')
    // .leftJoin('parameter as sg', 'u.statusgudangsama', 'sg.id')
    // .leftJoin('parameter as sb', 'u.statusbatalmuat', 'sb.id')
    // .leftJoin('parameter as sam', 'u.statusapprovalmandor', 'sam.id')
    // .leftJoin('mandor as mt', 'u.mandortrado_id', 'mt.id')
    // .leftJoin('mandor as ms', 'u.mandorsupir_id', 'ms.id')
    // .leftJoin('tarif as ta', 'u.tarif_id', 'ta.id')
    // .join(`${tempsuratpengantar1} as sp1`, 'u.id', 'sp1.id');

    // Mengambil data dari tabel sementara
    // const data = await dbBunga(tempTableName);
    //
    return query;
  }

  findOne(id: string) {
    return `This action returns a #${id} pengembaliankasgantungdetail`;
  }

  update(
    id: number,
    updatePengembaliankasgantungdetailDto: UpdatePengembaliankasgantungdetailDto,
  ) {
    return `This action updates a #${id} pengembaliankasgantungdetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} pengembaliankasgantungdetail`;
  }
}
