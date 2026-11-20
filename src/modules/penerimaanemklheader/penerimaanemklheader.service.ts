import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CreatePenerimaanemklheaderDto } from './dto/create-penerimaanemklheader.dto';
import { UpdatePenerimaanemklheaderDto } from './dto/update-penerimaanemklheader.dto';
import { RedisService } from 'src/common/redis/redis.service';
import { withUuidV7, formatDateToSQL, UtilsService  } from 'src/utils/utils.service';
import { tandatanya } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { LocksService } from '../locks/locks.service';
import { GlobalService } from '../global/global.service';
import { PenerimaanemkldetailService } from '../penerimaanemkldetail/penerimaanemkldetail.service';
import { PengeluaranheaderService } from '../pengeluaranheader/pengeluaranheader.service';
import { HutangheaderService } from '../hutangheader/hutangheader.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { Column, Workbook } from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PenerimaanheaderService } from '../penerimaanheader/penerimaanheader.service';

@Injectable()
export class PenerimaanemklheaderService implements OnModuleInit {
  private penerimaanheaderService: PenerimaanheaderService;

  constructor(
    // Inject wrapper RedisService (BUKAN raw 'REDIS_CLIENT'): set/get/del cache
    // jadi best-effort sehingga create/update tidak gagal 500 "Stream isn't
    // writeable" saat Redis mati. Lihat pengeluaranheader.service.ts.
    private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly penerimaanemkldetailService: PenerimaanemkldetailService,
    private readonly moduleRef: ModuleRef,
    private readonly hutangheaderService: HutangheaderService,
  ) {}

  onModuleInit() {
    this.penerimaanheaderService = this.moduleRef.get(PenerimaanheaderService, {
      strict: false,
    });
  }

  private readonly tableName = 'penerimaanemklheader';
  async create(data: any, trx: any) {
    try {
      let penerimaanNoBukti = data.penerimaan_nobukti;
      const hutangNoBukti = '';
      let grp = '';
      let subgrp = '';
      let postingdari = '';
      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)'; // Convert TEXT/NTEXT -> text
      const insertData = {
        nobukti: data.nobukti,
        tglbukti: formatDateToSQL(data.tglbukti),
        tgljatuhtempo: formatDateToSQL(data.tgljatuhtempo),
        keterangan: data.keterangan ?? null,
        karyawan_id: data.karyawan_id ?? null,
        jenisposting: data.jenisposting,
        bank_id: data.bank_id ?? null,
        nowarkat: data.nowarkat ?? null,
        penerimaan_nobukti:
          penerimaanNoBukti ?? data.penerimaan_nobukti ?? null,
        pengeluaran_nobukti: data.pengeluaran_nobukti ?? null,
        hutang_nobukti: hutangNoBukti ?? data.hutang_nobukti ?? null,
        statusformat: data.format ?? null,
        info: data.info ?? null,
        modifiedby: data.modifiedby ?? null,
        penerimaanemkl_id: data.penerimaanemkl_id ?? null,
        created_at: this.utilsService.getTime(),
        updated_at: this.utilsService.getTime(),
      };
      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['nobukti', 'keterangan', 'nowarkat'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });
      const parameter = await trx('parameter')
        .select('grp', 'subgrp')
        .where('id', data.format)
        .first();
      if (data.coaproses) {
        const penerimaanemklformat = await trx('penerimaanemkl')
          .where('coaproses', data.coaproses)
          .first();
        insertData.penerimaanemkl_id = penerimaanemklformat.id;
      }
      grp = parameter.grp;
      subgrp = parameter.subgrp;
      postingdari = parameter.memo_nama;
      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        grp,
        subgrp,
        this.tableName,
        String(insertData.tglbukti),
      );
      insertData.nobukti = nomorBukti;

      if (!data.coaproses) {
        const requestPenerimaan = {
          tglbukti: insertData.tglbukti,
          keterangan: insertData.keterangan,
          bank_id: insertData.bank_id,
          nowarkat: insertData.nowarkat,
          postingdari: postingdari,
        };

        const penerimaanDetails = data.details.map((detail: any) => {
          return {
            ...detail,
            coa: data.coakredit,
            penerimaanemklheader_nobukti: nomorBukti,
            modifiedby: data.modifiedby,
          };
        });

        const penerimaanData = {
          ...requestPenerimaan,
          details: penerimaanDetails,
        };
        const penerimaanResult = await this.penerimaanheaderService.create(
          penerimaanData,
          trx,
        );
        penerimaanNoBukti = penerimaanResult?.newItem?.nobukti;
        if (!penerimaanNoBukti) {
          throw new Error('Gagal membuat pengeluaran: nobukti tidak terbentuk');
        }
        insertData.penerimaan_nobukti = penerimaanNoBukti;
      }
      console.log(insertData, 'insertData33333');

      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');
      if (data.details.length > 0) {
        const detailsWithNobukti = data.details.map((detail: any) => {
          const {
            nobukti,
            transaksibiaya_nobukti,
            transaksilain_nobukti,
            ...rest
          } = detail;
          return {
            ...rest,
            nobukti: nomorBukti, // Inject nobukti into each detail
            pengeluaranemkl_nobukti: nobukti ?? detail.pengeluaranemkl_nobukti,
            modifiedby: insertData.modifiedby,
          };
        });
        console.log(detailsWithNobukti, 'detailsWithNobukti');
        // Pass the updated details with nobukti to the detail creation  service
        await this.penerimaanemkldetailService.create(
          detailsWithNobukti,
          insertedItems[0].id,
          trx,
        );
      }

      const newItem = insertedItems[0];

      const { data: filteredItems } = await this.findAll(
        {
          search: data.search,
          filters: data.filters,
          pagination: { page: data.page, limit: 0 },
          sort: { sortBy: data.sortBy, sortDirection: data.sortDirection },
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

      const pageNumber = Math.floor(itemIndex / data.limit) + 1;
      const endIndex = pageNumber * data.limit;

      // Ambil data hingga halaman yang mencakup item baru
      const limitedItems = filteredItems.slice(0, endIndex);

      // Simpan ke Redis
      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD PENERIMAAN EMKL HEADER`,
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby ?? null,
        },
        trx,
      );

      return {
        newItem,
        pageNumber,
        itemIndex,
      };
    } catch (error) {
      console.log(error);
      throw new Error(`Error: ${error}`);
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
      const tempUrl = `temp_url_${Math.random().toString(36).substring(2, 8)}`;

      await trx.schema.createTable(tempUrl, (t) => {
        t.integer('id').nullable();
        t.string('pengeluaran_nobukti').nullable();
        t.text('link').nullable();
      });
      const url = 'penerimaan';

      await trx(tempUrl).insert(
        trx
          .select(
            'u.id',
            'u.pengeluaran_nobukti',
            trx.raw(`
              STRING_AGG(
                '<a target="_blank" className="link-color" href="/dashboard/${url}' || ${tandatanya} || 'pengeluaran_nobukti=' || u.pengeluaran_nobukti || '">' ||
                '<HighlightWrapper value="' || u.pengeluaran_nobukti || '" />' ||
                '</a>', ','
              ) AS link
            `),
          )
          .from(this.tableName + ' as u')
          .groupBy('u.id', 'u.pengeluaran_nobukti'),
      );
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.nobukti', // nobukti (nvarchar(100))
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          trx.raw("TO_CHAR(u.tgljatuhtempo, 'DD-MM-YYYY') as tgljatuhtempo"),
          'u.keterangan', // keterangan (text)
          'u.karyawan_id', // keterangan (text)
          'k.nama as karyawan_nama',
          'p.text as jenisposting_nama',
          'u.jenisposting', // keterangan (text)
          'u.bank_id', // keterangan (text)
          'b.nama as bank_nama',
          'u.nowarkat', // keterangan (text)
          'u.penerimaan_nobukti', // keterangan (text)
          'u.pengeluaran_nobukti', // keterangan (text)
          'u.hutang_nobukti', // keterangan (text)
          'pe.nama as statusformat_nama',
          'u.statusformat', // bank_id (integer)
          'u.info', // info (text)
          'u.modifiedby', // modifiedby (varchar(200))
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"), // created_at (datetime)
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"), // updated_at (datetime)
          'tempUrl.link',
        ])
        .leftJoin('karyawan as k', 'u.karyawan_id', 'k.id')
        .leftJoin('parameter as p', 'u.jenisposting', 'p.id')
        .leftJoin('bank as b', 'u.bank_id', 'b.id')
        .leftJoin('penerimaanemkl as pe', 'u.statusformat', 'pe.format')
        .innerJoin(trx.raw(`${tempUrl} as tempUrl`), 'u.id', 'tempUrl.id');

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

        query.where((qb) => {
          searchFields.forEach((field) => {
            qb.orWhere(`u.${field}`, 'like', `%${sanitized}%`);
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          // Menambahkan pengecualian untuk 'tglDari' dan 'tglSampai'
          if (key === 'tglDari' || key === 'tglSampai') {
            continue; // Lewati filter jika key adalah 'tglDari' atau 'tglSampai'
          }

          if (value) {
            if (
              key === 'created_at' ||
              key === 'updated_at' ||
              key === 'tglbukti' ||
              key === 'tgljatuhtempo'
            ) {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'karyawan_nama') {
              query.andWhere('k.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'bank_nama') {
              query.andWhere('b.nama', 'like', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
            }
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

  async findOne(id: string, trx: any) {
    try {
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.nobukti', // nobukti (nvarchar(100))
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          trx.raw("TO_CHAR(u.tgljatuhtempo, 'DD-MM-YYYY') as tgljatuhtempo"),
          'u.keterangan', // keterangan (text)
          'u.karyawan_id', // keterangan (text)
          'k.nama as karyawan_nama',
          'p.text as jenisposting_nama',
          'u.jenisposting', // keterangan (text)
          'u.bank_id', // keterangan (text)
          'b.nama as bank_nama',
          'u.nowarkat', // keterangan (text)
          'u.pengeluaran_nobukti', // keterangan (text)
          'u.penerimaan_nobukti', // keterangan (text)
          'u.hutang_nobukti', // keterangan (text)
          'pe.nama as statusformat_nama',
          'u.statusformat', // bank_id (integer)
          'u.info', // info (text)
          'u.modifiedby', // modifiedby (varchar(200))
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"), // created_at (datetime)
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"), // updated_at (datetime)
        ])
        .leftJoin('karyawan as k', 'u.karyawan_id', 'k.id')
        .leftJoin('parameter as p', 'u.jenisposting', 'p.id')
        .leftJoin('bank as b', 'u.bank_id', 'b.id')
        .leftJoin('pengeluaranemkl as pe', 'u.statusformat', 'pe.format')
        .where('u.id', id);

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
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        pengembaliankasgantung_nobukti,
        relasi_nama,
        jenisposting_nama,
        coakredit,
        pengeluaran_nobukti,
        format,
        statusformat_nama,
        coadebet,
        alatbayar_nama,
        penerimaan_nobukti,
        bank_nama,
        karyawan_nama,
        details,
        ...insertData
      } = data;
      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['nobukti', 'keterangan', 'nowarkat'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });
      insertData.tglbukti = formatDateToSQL(String(insertData?.tglbukti)); // Fungsi untuk format
      insertData.tgljatuhtempo = formatDateToSQL(
        String(insertData?.tgljatuhtempo),
      ); // Fungsi untuk format

      const existingData = await trx(this.tableName).where('id', id).first();
      const penerimaanData = await trx('penerimaanheader')
        .where('nobukti', existingData.penerimaan_nobukti)
        .first();
      const hasChanges = this.utilsService.hasChanges(insertData, existingData);
      const requestPenerimaan = {
        nobukti: insertData.penerimaan_nobukti,
        tglbukti: insertData.tglbukti,
        keterangan: insertData.keterangan,
        bank_id: insertData.bank_id,
        nowarkat: insertData.nowarkat,
      };

      const penerimaanDetails = details.map((detail: any) => {
        const { id, ...rest } = detail;
        return {
          ...rest,
          id: '0',
          coa: coakredit,
          penerimaanemklheader_nobukti: insertData.penerimaan_nobukti,
          nobukti: insertData.penerimaan_nobukti,
          modifiedby: data.modifiedby,
        };
      });

      const payloadPenerimaan = {
        ...requestPenerimaan,
        details: penerimaanDetails,
      };
      const penerimaanResult = await this.penerimaanheaderService.update(
        penerimaanData.id,
        payloadPenerimaan,
        trx,
      );
      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();

        await trx(this.tableName).where('id', id).update(insertData);
      }
      if (details.length > 0) {
        const detailsWithNobukti = details.map((detail: any) => {
          const { id, ...rest } = detail;

          return {
            ...rest,
            id: '0',
            nobukti: insertData.nobukti, // Inject nobukti into each detail
            pengeluaranemkl_nobukti: detail.nobukti,
            modifiedby: insertData.modifiedby,
          };
        });

        // Pass the updated details with nobukti to the detail creation service
        await this.penerimaanemkldetailService.create(
          detailsWithNobukti,
          id,
          trx,
        );
      }
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
        (item) => String(item.id) === String(id),
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

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: `ADD PENGELUARAN EMKL HEADER`,
          idtrans: id,
          nobuktitrans: id,
          aksi: 'ADD',
          datajson: JSON.stringify(data),
          modifiedby: insertData.modifiedby,
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
      console.log(error);
      throw new Error(`Error: ${error}`);
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
        'penerimaanemkldetail',
        'penerimaanemklheader_id',
        trx,
      );
      const dataPenerimaan = await trx('penerimaanheader')
        .where('nobukti', deletedDataDetail.penerimaan_nobukti)
        .first();
      await this.penerimaanheaderService.delete(
        dataPenerimaan.id,
        trx,
        modifiedby,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE PENERIMAAN EMKL DETAIL',
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
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }

  async exportToExcel(data: any[], trx: any) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    // Header laporan
    worksheet.mergeCells('A1:D1');
    worksheet.mergeCells('A2:D2');
    worksheet.mergeCells('A3:D3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN PENERIMAAN EMKL';
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
      const detailRes = await this.penerimaanemkldetailService.findAll(
        {
          filters: {
            nobukti: h.nobukti,
          },
        },
        trx,
      );
      const details = detailRes.data ?? [];

      const headerInfo = [
        ['No Bukti', h.nobukti ?? ''],
        ['Tanggal Bukti', h.tglbukti ?? ''],
        ['Keterangan', h.keterangan ?? ''],
      ];

      headerInfo.forEach(([label, value]) => {
        worksheet.getCell(`A${currentRow}`).value = label;
        worksheet.getCell(`A${currentRow}`).font = {
          bold: true,
          name: 'Tahoma',
          size: 10,
        };
        worksheet.getCell(`B${currentRow}`).value = value;
        worksheet.getCell(`B${currentRow}`).font = { name: 'Tahoma', size: 10 };
        currentRow++;
      });

      currentRow++;

      if (details.length > 0) {
        const tableHeaders = ['NO.', 'NO BUKTI', 'KETERANGAN', 'NOMINAL'];
        tableHeaders.forEach((header, index) => {
          const cell = worksheet.getCell(currentRow, index + 1);
          cell.value = header;
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFF00' },
          };
          cell.font = { bold: true, name: 'Tahoma', size: 10 };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
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
            d.nobukti ?? '',
            d.keterangan ?? '',
            d.nominal ?? '',
          ];
          rowValues.forEach((value, colIndex) => {
            const cell = worksheet.getCell(currentRow, colIndex + 1);
            cell.value = value;
            cell.font = { name: 'Tahoma', size: 10 };

            // kolom angka rata kanan, selain itu rata kiri
            if (colIndex === 3) {
              // kolom nominal
              cell.alignment = { horizontal: 'right', vertical: 'middle' };
            } else if (colIndex === 0) {
              // kolom nomor
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

        // Tambahkan total nominal
        const totalNominal = details.reduce((sum: number, d: any) => {
          return sum + (parseFloat(d.nominal) || 0);
        }, 0);

        // Row total dengan border atas tebal
        const totalRow = currentRow;
        worksheet.getCell(`A${totalRow}`).value = 'TOTAL';
        worksheet.getCell(`A${totalRow}`).font = {
          bold: true,
          name: 'Tahoma',
          size: 10,
        };
        worksheet.getCell(`A${totalRow}`).alignment = {
          horizontal: 'left',
          vertical: 'middle',
        };
        worksheet.getCell(`A${totalRow}`).border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };

        worksheet.mergeCells(`A${totalRow}:C${totalRow}`);

        worksheet.getCell(`D${totalRow}`).value = totalNominal;
        worksheet.getCell(`D${totalRow}`).font = {
          bold: true,
          name: 'Tahoma',
          size: 10,
        };
        worksheet.getCell(`D${totalRow}`).alignment = {
          horizontal: 'right',
          vertical: 'middle',
        };
        worksheet.getCell(`D${totalRow}`).border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };

        currentRow++;
      }
    }

    worksheet.columns
      .filter((c): c is Column => !!c)
      .forEach((col) => {
        let maxLength = 0;
        col.eachCell({ includeEmpty: true }, (cell) => {
          const cellValue = cell.value ? cell.value.toString() : '';
          maxLength = Math.max(maxLength, cellValue.length);
        });
        col.width = maxLength + 2;
      });

    worksheet.getColumn(1).width = 20;
    worksheet.getColumn(2).width = 30;

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const tempFilePath = path.resolve(
      tempDir,
      `laporan_pengeluaran_emkl${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }

  async getPenerimaan(dari: any, sampai: any, trx: any) {
    try {
      const tglDariFormatted = formatDateToSQL(dari);
      const tglSampaiFormatted = formatDateToSQL(sampai);
      const temp = 'temp_' + Math.random().toString(36).substring(2, 8);

      // Membuat tabel sementara
      await trx.schema.createTable(temp, (t) => {
        t.string('nobukti');
        t.date('tglbukti');
        t.bigInteger('sisa').nullable();
        t.bigInteger('sudah_dibayar').nullable();
        t.bigInteger('jumlahpinjaman').nullable();
        t.text('keterangan').nullable();
        t.string('transaksilain_nobukti').nullable();
        t.string('transaksibiaya_nobukti').nullable();
        t.bigInteger('dpp').nullable();
        t.string('coadebet').nullable();
        t.string('coadebet_text').nullable();
      });

      // Menyisipkan data ke dalam tabel sementara
      await trx(temp).insert(
        trx
          .select(
            'ped.nobukti',
            trx.raw('CAST(pgh.tglbukti AS DATE) AS tglbukti'),
            trx.raw(`
              CASE 
                WHEN pe.nilaiprosespengeluaran = (SELECT id FROM parameter WHERE grp = 'NILAI PROSES' AND text = 'NEGATIF' LIMIT 1) THEN
                  -1 * (
                    COALESCE(
                      (SELECT SUM(ped_inner.nominal) FROM penerimaanemkldetail AS ped_inner WHERE ped_inner.nobukti = ped.nobukti),
                      0
                    ) - 
                    COALESCE(
                      (SELECT SUM(pd.nominal) FROM pengeluaranemkldetail AS pd WHERE pd.penerimaanemkl_nobukti = ped.nobukti),
                      0
                    )
                  )
                ELSE
                  COALESCE(
                    (SELECT SUM(ped_inner.nominal) FROM penerimaanemkldetail AS ped_inner WHERE ped_inner.nobukti = ped.nobukti),
                    0
                  ) - 
                  COALESCE(
                    (SELECT SUM(pd.nominal) FROM pengeluaranemkldetail AS pd WHERE pd.penerimaanemkl_nobukti = ped.nobukti),
                    0
                  )
              END AS sisa
            `),
            trx.raw(`
              CASE 
                WHEN pe.nilaiprosespengeluaran = (SELECT id FROM parameter WHERE grp = 'NILAI PROSES' AND text = 'NEGATIF' LIMIT 1) THEN
                  -1 * COALESCE(
                    (SELECT SUM(pd.nominal) FROM pengeluaranemkldetail AS pd WHERE pd.penerimaanemkl_nobukti = ped.nobukti),
                    0
                  )
                ELSE
                  COALESCE(
                    (SELECT SUM(pd.nominal) FROM pengeluaranemkldetail AS pd WHERE pd.penerimaanemkl_nobukti = ped.nobukti),
                    0
                  )
              END AS sudah_dibayar
            `),
            trx.raw(`
              CASE 
                WHEN pe.nilaiprosespengeluaran = (SELECT id FROM parameter WHERE grp = 'NILAI PROSES' AND text = 'NEGATIF' LIMIT 1) THEN
                  -1 * COALESCE(
                    (SELECT SUM(ped_inner.nominal) FROM penerimaanemkldetail AS ped_inner WHERE ped_inner.nobukti = pgh.nobukti),
                    0
                  )
                ELSE
                  COALESCE(
                    (SELECT SUM(ped_inner.nominal) FROM penerimaanemkldetail AS ped_inner WHERE ped_inner.nobukti = pgh.nobukti),
                    0
                  )
              END AS jumlahpinjaman
            `),
            trx.raw('MAX(ped.keterangan) AS keterangan'),
            'pged.transaksilain_nobukti as transaksilain_nobukti',
            'pged.transaksibiaya_nobukti as transaksibiaya_nobukti',
            'pged.dpp as dpp',
            'pged.coadebet as coadebet',
            'ap.keterangancoa as coadebet_text',
          )
          .from('penerimaanemkldetail as ped')
          .leftJoin(
            'penerimaanemklheader as pgh',
            'pgh.id',
            'ped.penerimaanemklheader_id',
          )
          .leftJoin('penerimaanemkl as pe', 'pe.id', 'pgh.penerimaanemkl_id')
          .leftJoin(
            'penerimaandetail as pged',
            'pgh.penerimaan_nobukti',
            'pged.nobukti',
          )
          .leftJoin('akunpusat as ap', 'ap.coa', 'pged.coadebet')
          .whereBetween('pgh.tglbukti', [tglDariFormatted, tglSampaiFormatted])
          .groupBy(
            'ped.nobukti',
            'pgh.tglbukti',
            'pgh.nobukti',
            'pged.nobukti',
            'pged.transaksilain_nobukti',
            'pged.transaksibiaya_nobukti',
            'pged.dpp',
            'pged.coadebet',
            'ap.keterangancoa',
            'pe.nilaiprosespengeluaran', // Tambahkan ke GROUP BY
          )
          .orderBy('pgh.tglbukti', 'asc')
          .orderBy('ped.nobukti', 'asc'),
      );

      // Mengambil data dari tabel sementara
      const result = trx
        .select(
          trx.raw(`row_number() OVER (ORDER BY ??) as id`, [`${temp}.nobukti`]),
          trx.raw(`TO_CHAR(${temp}.tglbukti, 'DD-MM-YYYY') as tglbukti`),
          `${temp}.nobukti`,
          `${temp}.sisa`,
          `${temp}.sudah_dibayar`,
          `${temp}.jumlahpinjaman`,
          `${temp}.keterangan as keterangan`,
          `${temp}.transaksilain_nobukti as transaksilain_nobukti`,
          `${temp}.transaksibiaya_nobukti as transaksibiaya_nobukti`,
          `${temp}.coadebet_text as coadebet_text`,
          `${temp}.dpp as dpp`,
          `${temp}.coadebet as coadebet`,
        )
        .from(`${temp}`)
        .where(function () {
          this.whereRaw(`${temp}.sisa != 0`).orWhereRaw(`${temp}.sisa is null`);
        });

      return result;
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async checkValidasi(aksi: string, value: any, editedby: any, trx: any) {
    try {
      if (aksi === 'EDIT') {
        const forceEdit = await this.locksService.forceEdit(
          this.tableName,
          value,
          editedby,
          trx,
        );

        return forceEdit;
      } else if (aksi === 'DELETE') {
        const validasi = await this.globalService.checkUsed(
          'pengembalianjurnalumumdetail',
          'jurnalumum_nobukti',
          value,
          trx,
        );

        return validasi;
      }
    } catch (error) {
      console.error('Error di checkValidasi:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }
}
