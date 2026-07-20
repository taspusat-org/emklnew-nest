import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateHutangheaderDto } from './dto/create-hutangheader.dto';
import { UpdateHutangheaderDto } from './dto/update-hutangheader.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { RedisService } from 'src/common/redis/redis.service';
import {
  withUuidV7,
  formatDateToSQL,
  UtilsService,
  tandatanya,
 } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { HutangdetailService } from '../hutangdetail/hutangdetail.service';
import { JurnalumumheaderService } from '../jurnalumumheader/jurnalumumheader.service';
import { GlobalService } from '../global/global.service';
import { LocksService } from '../locks/locks.service';
import * as fs from 'fs';
import * as path from 'path';
import { Workbook, Column } from 'exceljs';
import { StatuspendukungService } from '../statuspendukung/statuspendukung.service';

@Injectable()
export class HutangheaderService {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly hutangdetailService: HutangdetailService,
    private readonly JurnalumumheaderService: JurnalumumheaderService,
    private readonly statuspendukungService: StatuspendukungService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
  ) {}
  private readonly tableName = 'hutangheader';

  async create(data: any, trx: any) {
    try {
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        coa_text,
        relasi_text,
        details,
        modifiedby,
        created_at,
        updated_at,
        ...insertData
      } = data;

      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['nobukti', 'keterangan'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });
      insertData.tglbukti = formatDateToSQL(String(insertData?.tglbukti)); // Fungsi untuk format
      insertData.tgljatuhtempo = formatDateToSQL(
        String(insertData?.tgljatuhtempo),
      ); // Fungsi untuk format
      insertData.modifiedby = modifiedby;
      insertData.created_at = created_at || this.utilsService.getTime();
      insertData.updated_at = updated_at || this.utilsService.getTime();

      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
      const getParam = await trx('parameter')
        .select([
          'id',
          'grp',
          'subgrp',
          'kelompok',
          trx.raw(`JSON_VALUE(${memoExpr}, '$.COA') as coa_nama`),
          trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') as memo_nama`),
        ])
        .whereRaw("RTRIM(LTRIM(grp)) = 'NOMOR HUTANG'")
        .andWhereRaw("RTRIM(LTRIM(subgrp)) = 'NOMOR HUTANG'")
        .andWhereRaw("RTRIM(LTRIM(kelompok)) = 'HUTANG'")
        .first();

      if (!getParam) {
        throw new Error(`Parameter tidak ditemukan`);
      }

      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        getParam.grp,
        getParam.subgrp,
        this.tableName,
        insertData.tglbukti,
      );
      insertData.nobukti = nomorBukti;
      insertData.coa = getParam.coa_nama;
      insertData.statusformat = getParam.id ? getParam.id : null;

      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

      if (details.length > 0) {
        const detailsWithNobukti = details.map(
          ({ coa_text, tglinvoiceemkl, ...detail }: any) => ({
            ...detail,
            tglinvoiceemkl: formatDateToSQL(tglinvoiceemkl),
            nobukti: nomorBukti,
            modifiedby: data.modifiedby || null,
          }),
        );
        await this.hutangdetailService.create(
          detailsWithNobukti,
          insertedItems[0].id,
          trx,
        );
      }

      const defaultCoa = getParam.coa_nama;

      if (!defaultCoa) {
        throw new Error(
          'Default COA untuk jurnal umum tidak ditemukan di memo',
        );
      }

      const processDetails = (details) => {
        return details.flatMap((detail) => [
          {
            id: 0,
            coa: detail.coa,
            nobukti: nomorBukti,
            tglbukti: formatDateToSQL(insertData.tglbukti),
            keterangan: detail.keterangan,
            nominaldebet: detail.nominal,
            nominalkredit: '',
          },
          {
            id: 0,
            coa: defaultCoa,
            nobukti: nomorBukti,
            tglbukti: formatDateToSQL(insertData.tglbukti),
            keterangan: detail.keterangan,
            nominaldebet: '',
            nominalkredit: detail.nominal,
          },
        ]);
      };

      const result = processDetails(details);

      const jurnalPayload = {
        nobukti: nomorBukti,
        tglbukti: insertData.tglbukti,
        postingdari: getParam.memo_nama,
        statusformat: getParam.id,
        keterangan: insertData.keterangan,
        created_at: this.utilsService.getTime(),
        updated_at: this.utilsService.getTime(),
        modifiedby: insertData.modifiedby,
        details: result,
      };

      const jurnalHeaderInserted = await this.JurnalumumheaderService.create(
        jurnalPayload,
        trx,
      );

      const newItem = insertedItems[0];

      const { data: filteredItems } = await this.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false, // Set based on your requirement (e.g., lookup flag)
        },
        trx,
      );

      // Cari index item baru di hasil yang sudah difilter
      let itemIndex = filteredItems.findIndex(
        (item) => String(item.id) === String(newItem.id),
      );

      if (itemIndex === -1) {
        itemIndex = 0;
      }

      const pageNumber = Math.floor(itemIndex / limit) + 1;
      const endIndex = pageNumber * limit;

      // Ambil data hingga halaman yang mencakup item baru
      const limitedItems = filteredItems.slice(0, endIndex);

      // Simpan ke Redis
      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      await this.statuspendukungService.create(
        this.tableName,
        newItem.id,
        data.modifiedby,
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD HUTANG HEADER`,
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      return {
        newItem,
        pageNumber,
        itemIndex,
      };
    } catch (error) {
      throw new Error(`Error: ${error.message}`);
    }
  }

  async findAll(
    { search, filters, pagination, sort, isLookUp }: FindAllParams,
    trx: any,
  ) {
    try {
      let { page, limit } = pagination ?? {};

      page = page ?? 1;
      limit = limit ?? 0;

      if (isLookUp) {
        const acoCountResult = await trx(this.tableName)
          .count('id as total')
          .first();

        const acoCount = acoCountResult?.total || 0;

        if (Number(acoCount) > 500) {
          return { data: { type: 'json' } };
        } else {
          limit = 0;
        }
      }

      const tempUrl = `##temp_url_${Math.random().toString(36).substring(2, 8)}`;

      await trx.schema.createTable(tempUrl, (t) => {
        t.integer('id').nullable();
        t.string('nobukti').nullable();
        t.text('link').nullable();
      });
      const url = 'jurnalumumheader';

      await trx(tempUrl).insert(
        trx
          .select(
            'u.id',
            'u.nobukti',
            trx.raw(`
                          STRING_AGG(
                            '<a target="_blank" className="link-color" href="/dashboard/${url}' + ${tandatanya} + 'nobukti=' + u.nobukti + '">' +
                            '<HighlightWrapper value="' + u.nobukti + '" />' +
                            '</a>', ','
                          ) AS link
                        `),
          )
          .from(this.tableName + ' as u')
          .groupBy('u.id', 'u.nobukti'),
      );

      const query = trx
        .from(trx.raw(`${this.tableName} as u`))
        .select([
          'u.id as id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          trx.raw("TO_CHAR(u.tgljatuhtempo, 'DD-MM-YYYY') as tgljatuhtempo"),
          'u.keterangan',
          'u.relasi_id',
          'u.coa',
          'u.statusformat',
          'u.modifiedby',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'r.nama as relasi_text',
          'a.keterangancoa as coa_text',
          'tempUrl.link',
        ])
        .leftJoin(
          trx.raw(`${tempUrl} as tempUrl`),
          'u.nobukti',
          'tempUrl.nobukti',
        )
        .leftJoin(
          trx.raw('relasi as r'),
          'u.relasi_id',
          'r.id',
        )
        .leftJoin(
          trx.raw('akunpusat as a'),
          'u.coa',
          'a.coa',
        );

      if (filters?.tglDari && filters?.tglSampai) {
        // Mengonversi tglDari dan tglSampai ke format yang diterima SQL (YYYY-MM-DD)
        const tglDariFormatted = formatDateToSQL(String(filters?.tglDari)); // Fungsi untuk format
        const tglSampaiFormatted = formatDateToSQL(String(filters?.tglSampai));

        // Menggunakan whereBetween dengan tanggal yang sudah diformat
        query.whereBetween('u.tglbukti', [
          tglDariFormatted,
          tglSampaiFormatted,
        ]);
      }
      const excludeSearchKeys = ['tglDari', 'tglSampai', 'relasi_id', 'coa'];
      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k) && filters![k],
      );

      if (search) {
        const sanitizedValue = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (['created_at', 'updated_at'].includes(field)) {
              qb.orWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') like ?", [
                field,
                `%${sanitizedValue}%`,
              ]);
            } else if (['tglbukti', 'tgljatuhtempo'].includes(field)) {
              qb.orWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY') like ?", [
                field,
                `%${sanitizedValue}%`,
              ]);
            } else if (field === 'relasi_text') {
              qb.orWhere('r.nama', 'like', `%${sanitizedValue}%`);
            } else if (field === 'coa_text') {
              qb.orWhere('a.keterangancoa', 'like', `%${sanitizedValue}%`);
            } else {
              qb.orWhere(`u.${field}`, 'like', `%${sanitizedValue}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (!value || key === 'tglDari' || key === 'tglSampai') continue;

          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          switch (key) {
            case 'created_at':
            case 'updated_at':
            case 'editing_at':
            case 'tglbukti':
            case 'tgljatuhtempo':
              query.andWhereRaw(
                `TO_CHAR(u.${key}, 'DD-MM-YYYY HH24:MI:SS') LIKE ?`,
                [`%${sanitizedValue}%`],
              );
              break;
            case 'relasi_text':
              query.andWhere('r.nama', 'like', `%${sanitizedValue}%`);
              break;
            case 'coa_text':
              query.andWhere('a.keterangancoa', 'like', `%${sanitizedValue}%`);
              break;
            default:
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
              break;
          }
        }
      }

      const result = await trx(this.tableName).count('id as total').first();
      const total = result?.total as number;
      const totalPages = Math.ceil(total / limit);

      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }

      const data = await query;

      const responseType = Number(total) > 500 ? 'json' : 'local';

      return {
        data: data,
        type: responseType,
        total,
        pagination: {
          currentPage: page,
          totalPages: totalPages,
          totalItems: total,
          itemsPerPage: limit,
        },
      };
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async findOne(
    { search, filters, pagination, sort }: FindAllParams,
    id: string,
    trx: any,
  ) {
    try {
      let { page, limit } = pagination ?? {};

      page = page ?? 1;
      limit = limit ?? 0;

      const query = trx
        .from(trx.raw(`${this.tableName} as u`))
        .select([
          'u.id as id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          trx.raw("TO_CHAR(u.tgljatuhtempo, 'DD-MM-YYYY') as tgljatuhtempo"),
          'u.keterangan',
          'u.relasi_id',
          'u.coa',
          'u.statusformat',
          'u.modifiedby',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'r.nama as relasi_text',
          'a.keterangancoa as coa_text',
        ])
        .leftJoin(
          trx.raw('relasi as r'),
          'u.relasi_id',
          'r.id',
        )
        .leftJoin(
          trx.raw('akunpusat as a'),
          'u.coa',
          'a.coa',
        )
        .where('u.id', id);

      if (filters?.tglDari && filters?.tglSampai) {
        // Mengonversi tglDari dan tglSampai ke format yang diterima SQL (YYYY-MM-DD)
        const tglDariFormatted = formatDateToSQL(String(filters?.tglDari)); // Fungsi untuk format
        const tglSampaiFormatted = formatDateToSQL(String(filters?.tglSampai));

        // Menggunakan whereBetween dengan tanggal yang sudah diformat
        query.whereBetween('u.tglbukti', [
          tglDariFormatted,
          tglSampaiFormatted,
        ]);
      }
      const excludeSearchKeys = ['tglDari', 'tglSampai'];
      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k) && filters![k],
      );
      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();

        query.andWhere((qb) => {
          searchFields.forEach((field) => {
            if (field === 'relasi_text') {
              qb.orWhere('r.nama', 'like', `%${sanitized}%`);
            } else if (field === 'coa_text') {
              qb.orWhere('a.keterangancoa', 'like', `%${sanitized}%`);
            } else {
              qb.orWhere(`u.${field}`, 'like', `%${sanitized}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (!value || key === 'tglDari' || key === 'tglSampai') continue;

          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          switch (key) {
            case 'created_at':
            case 'updated_at':
            case 'editing_at':
            case 'tglbukti':
            case 'tgljatuhtempo':
              query.andWhereRaw(
                `TO_CHAR(u.${key}, 'DD-MM-YYYY HH24:MI:SS') LIKE ?`,
                [`%${sanitizedValue}%`],
              );
              break;
            case 'relasi_text':
              query.andWhere('r.nama', 'like', `%${sanitizedValue}%`);
              break;
            case 'coa_text':
              query.andWhere('a.keterangancoa', 'like', `%${sanitizedValue}%`);
              break;
            default:
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
              break;
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }

      const data = await query;

      return {
        data: data,
      };
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async update(id: any, data: any, trx: any) {
    try {
      data.tglbukti = formatDateToSQL(String(data?.tglbukti));
      data.tgljatuhtempo = formatDateToSQL(String(data?.tgljatuhtempo));

      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        relasi_text,
        coa_text,
        details,
        ...insertData
      } = data;

      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['nobukti', 'keterangan'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      const existingData = await trx(this.tableName).where('id', id).first();
      if (!existingData) {
        throw new Error(`Hutang dengan id ${id} tidak ditemukan`);
      }

      if (!insertData.coa) {
        insertData.coa = existingData?.coa;
      }

      // Get parameter untuk jurnal
      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
      const getParam = await trx('parameter')
        .select([
          'id',
          'grp',
          'subgrp',
          'kelompok',
          trx.raw(`JSON_VALUE(${memoExpr}, '$.COA') as coa_nama`),
          trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') as memo_nama`),
        ])
        .whereRaw("RTRIM(LTRIM(grp)) = 'NOMOR HUTANG'")
        .andWhereRaw("RTRIM(LTRIM(subgrp)) = 'NOMOR HUTANG'")
        .andWhereRaw("RTRIM(LTRIM(kelompok)) = 'HUTANG'")
        .first();

      const hasChanges = this.utilsService.hasChanges(insertData, existingData);

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();

        if (!insertData.coa) {
          insertData.coa = existingData?.coa;
        }

        await trx(this.tableName).where('id', id).update(insertData);
      }

      // Handle detail updates
      if (details && details.length > 0) {
        const nobuktiHeader = insertData.nobukti || existingData.nobukti;
        const cleanedDetails = details.map(
          ({ coa_text, tglinvoiceemkl, ...rest }) => ({
            ...rest,
            nobukti: nobuktiHeader,
            tglinvoiceemkl: formatDateToSQL(tglinvoiceemkl),
            modifiedby: insertData.modifiedby || existingData.modifiedby,
          }),
        );

        await this.hutangdetailService.create(cleanedDetails, id, trx);
      }

      // Update jurnal jika ada perubahan
      if (hasChanges || (details && details.length > 0)) {
        const updatedData = { ...existingData, ...insertData };
        const nobukti = updatedData.nobukti;

        if (!getParam) {
          console.warn(
            'Parameter untuk jurnal tidak ditemukan, skip update jurnal',
          );
        } else {
          const defaultCoa = getParam.coa_nama;

          if (!defaultCoa) {
            console.warn(
              'Default COA untuk jurnal tidak ditemukan di memo, skip update jurnal',
            );
          } else {
            // Process details untuk jurnal
            const processDetails = (details) => {
              return details.flatMap((detail) => [
                {
                  id: 0, // Set 0 untuk update, service akan handle existing ID
                  coa: detail.coa,
                  nobukti: nobukti,
                  tglbukti: formatDateToSQL(updatedData.tglbukti),
                  keterangan: detail.keterangan,
                  nominaldebet: detail.nominal,
                  nominalkredit: '',
                  modifiedby: updatedData.modifiedby,
                },
                {
                  id: 0, // Set 0 untuk update, service akan handle existing ID
                  coa: defaultCoa,
                  nobukti: nobukti,
                  tglbukti: formatDateToSQL(updatedData.tglbukti),
                  keterangan: detail.keterangan,
                  nominaldebet: '',
                  nominalkredit: detail.nominal,
                  modifiedby: updatedData.modifiedby,
                },
              ]);
            };

            const jurnalDetails = processDetails(details || []);

            // Cari jurnal header yang existing berdasarkan nobukti
            const existingJurnal = await trx('jurnalumumheader')
              .where('nobukti', nobukti)
              .first();

            if (existingJurnal) {
              // Update existing jurnal
              const jurnalUpdatePayload = {
                nobukti: nobukti,
                tglbukti: updatedData.tglbukti,
                postingdari: getParam.memo_nama,
                statusformat: getParam.id,
                keterangan: updatedData.keterangan,
                updated_at: this.utilsService.getTime(),
                modifiedby: updatedData.modifiedby,
                details: jurnalDetails,
              };

              console.log(
                'Updating existing jurnal hutang with ID:',
                existingJurnal.id,
              );
              await this.JurnalumumheaderService.update(
                existingJurnal.id,
                jurnalUpdatePayload,
                trx,
              );
            } else {
              // Create new jurnal jika tidak ada (fallback)
              const jurnalCreatePayload = {
                nobukti: nobukti,
                tglbukti: updatedData.tglbukti,
                postingdari: getParam.memo_nama,
                statusformat: getParam.id,
                keterangan: updatedData.keterangan,
                created_at: this.utilsService.getTime(),
                updated_at: this.utilsService.getTime(),
                modifiedby: updatedData.modifiedby,
                details: jurnalDetails,
              };

              console.log('Creating new jurnal hutang for nobukti:', nobukti);
              await this.JurnalumumheaderService.create(
                jurnalCreatePayload,
                trx,
              );
            }
          }
        }
      }

      const { data: filteredItems } = await this.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false,
        },
        trx,
      );

      let itemIndex = filteredItems.findIndex((item) => Number(item.id) === id);
      if (itemIndex === -1) {
        itemIndex = 0;
      }

      const pageNumber = Math.floor(itemIndex / limit) + 1;
      const endIndex = pageNumber * limit;
      const limitedItems = filteredItems.slice(0, endIndex);

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `EDIT HUTANG HEADER`,
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      return {
        updatedItem: {
          id,
          ...data,
        },
        pageNumber,
        itemIndex,
      };
    } catch (error) {
      console.error('Error in hutang update:', error);
      throw new Error(`Error: ${error.message}`);
    }
  }

  async delete(id: string, trx: any, modifiedby: string) {
    try {
      const deletedData = await this.utilsService.lockAndDestroy(
        id,
        this.tableName,
        'id',
        trx,
      );
      const deletedDataDetail = await this.utilsService.lockAndDestroy(
        id,
        'hutangdetail',
        'hutang_id',
        trx,
      );
      await this.statuspendukungService.remove(id, modifiedby, trx);

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE HUTANG DETAIL',
          idtrans: deletedDataDetail.id,
          nobuktitrans: deletedDataDetail.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedDataDetail),
          modifiedby: modifiedby,
        },
        trx,
      );

      return { status: 200, message: 'Data deleted successfully', deletedData };
    } catch (error) {
      console.error('Error deleting data:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }

  async exportToExcel(data: any[], trx: any) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    // Header laporan
    worksheet.mergeCells('A1:D1'); // Ubah dari E1 ke D1 karena hanya 4 kolom
    worksheet.mergeCells('A2:D2'); // Ubah dari E2 ke D2 karena hanya 4 kolom
    worksheet.mergeCells('A3:D3'); // Ubah dari E3 ke D3 karena hanya 4 kolom

    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN HUTANG';
    worksheet.getCell('A3').value = 'Data Export';

    ['A1', 'A2', 'A3'].forEach((cellKey, i) => {
      worksheet.getCell(cellKey).alignment = {
        horizontal: 'center',
        vertical: 'middle',
      };
      worksheet.getCell(cellKey).font = {
        name: 'Tahoma',
        size: i === 0 ? 14 : 10,
        bold: true,
      };
    });

    let currentRow = 5;

    for (const h of data) {
      const detailRes = await this.hutangdetailService.findAll(
        {
          filters: {
            nobukti: h.nobukti,
          },
        },
        trx,
      );
      const details = detailRes.data ?? [];

      const headerInfo = [
        ['Nomor Bukti', h.nobukti ?? ''],
        ['Tanggal Bukti', h.tglbukti ?? ''],
        ['Tanggal Jatuh Tempo', h.tgljatuhtempo ?? ''],
        ['Keterangan', h.keterangan ?? ''],
        ['Supplier', h.relasi_text ?? ''],
        ['Coa', h.coa_text ?? ''],
      ];

      // Merge kolom A dan B untuk seluruh area header info
      const headerStartRow = currentRow;
      const headerEndRow = currentRow + headerInfo.length - 1;

      headerInfo.forEach(([label, value]) => {
        worksheet.getCell(`A${currentRow}`).value = label;
        worksheet.getCell(`A${currentRow}`).font = {
          bold: true,
          name: 'Tahoma',
          size: 10,
        };
        worksheet.getCell(`C${currentRow}`).value = value;
        worksheet.getCell(`C${currentRow}`).font = {
          name: 'Tahoma',
          size: 10,
        };
        currentRow++;
      });

      for (let row = headerStartRow; row <= headerEndRow; row++) {
        worksheet.mergeCells(`A${row}:B${row}`);
      }

      currentRow++;

      if (details.length > 0) {
        const tableHeaders = ['NO.', 'NAMA PERKIRAAN', 'KETERANGAN', 'NOMINAL'];

        tableHeaders.forEach((header, index) => {
          const cell = worksheet.getCell(currentRow, index + 1);
          cell.value = header;
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFF00' },
          };
          cell.font = {
            bold: true,
            name: 'Tahoma',
            size: 10,
          };
          cell.alignment = {
            horizontal: 'center',
            vertical: 'middle',
          };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
        });
        currentRow++;

        details.forEach((d: any, detailIndex: number) => {
          const rowValues = [
            detailIndex + 1,
            d.coa_text ?? '',
            d.keterangan ?? '',
            d.nominal ?? 0,
          ];

          rowValues.forEach((value, colIndex) => {
            const cell = worksheet.getCell(currentRow, colIndex + 1);
            cell.value = value;
            cell.font = {
              name: 'Tahoma',
              size: 10,
            };

            if (colIndex === 3) {
              cell.alignment = { horizontal: 'right', vertical: 'middle' };
            } else if (colIndex === 0) {
              cell.alignment = { horizontal: 'center', vertical: 'middle' };
            } else {
              cell.alignment = { horizontal: 'left', vertical: 'middle' };
            }

            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' },
            };
          });
          currentRow++;
        });

        const totalNominal = details.reduce(
          (sum: number, d: any) => sum + (Number(d.nominal) || 0),
          0,
        );

        const totalLabelCell = worksheet.getCell(currentRow, 3);
        totalLabelCell.value = 'TOTAL';
        totalLabelCell.font = { bold: true, name: 'Tahoma', size: 10 };
        totalLabelCell.alignment = { horizontal: 'left', vertical: 'middle' };
        totalLabelCell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };

        const totalValueCell = worksheet.getCell(currentRow, 4);
        totalValueCell.value = totalNominal;
        totalValueCell.font = { bold: true, name: 'Tahoma', size: 10 };
        totalValueCell.alignment = { horizontal: 'right', vertical: 'middle' };
        totalValueCell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };

        currentRow++;
      }
    }

    worksheet.getColumn(1).width = 6;

    worksheet.getColumn(2).width = 35;

    worksheet.getColumn(3).width = 25;

    worksheet.getColumn(4).width = 15;

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_hutang${Date.now()}.xlsx`,
    );

    await workbook.xlsx.writeFile(tempFilePath);
    return tempFilePath;
  }
}
