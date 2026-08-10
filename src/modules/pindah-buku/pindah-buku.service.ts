import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Column, Workbook } from 'exceljs';
import { LocksService } from '../locks/locks.service';
import { withUuidV7, formatDateToSQL, UtilsService  } from 'src/utils/utils.service';
import { GlobalService } from '../global/global.service';
import { RedisService } from 'src/common/redis/redis.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { JurnalumumheaderService } from '../jurnalumumheader/jurnalumumheader.service';

@Injectable()
export class PindahBukuService {
  private readonly tableName: string = 'pindahbuku';

  // Uppercase HANYA kolom teks manusiawi. bankdari_id/bankke_id/alatbayar_id/
  // statusformat/id adalah UUID, dan coadebet/coakredit diisi dari bank.coa —
  // semuanya nilai eksak yang tak boleh diubah casing-nya. statusformat di atas
  // di-set dari getFormatPindahBuku.id, dan alatbayar_id menunjuk alatbayar
  // yang mayoritas id-nya kini uuid v7 HURUF KECIL: blanket uppercase menulis
  // id yang tidak ada dan (tanpa FK) diterima Postgres diam-diam sehingga
  // lookup tampil kosong — lihat pengeluaranheader.service.ts.
  private readonly uppercaseFields = ['nobukti', 'nowarkat', 'keterangan'];

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly locksService: LocksService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
    private readonly jurnalUmumHeaderService: JurnalumumheaderService,
  ) {}

  async create(createData: any, trx: any) {
    try {
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        method,
        bankdari_nama,
        bankke_nama,
        alatbayar_nama,
        ...insertData
      } = createData;

      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
      const getFormatPindahBuku = await trx
        .from(trx.raw(`parameter`))
        .select([
          'id',
          'grp',
          'subgrp',
          trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') as memo_nama`),
        ])
        .where('grp', 'NOMOR PINDAH BUKU')
        .first();

      createData.tglbukti = formatDateToSQL(String(createData?.tglbukti));
      const nomorBukti = await this.runningNumberService.generateRunningNumber(
        trx,
        getFormatPindahBuku.grp,
        getFormatPindahBuku.subgrp,
        this.tableName,
        createData.tglbukti,
      );

      const getCoaDebet = await trx
        .from(trx.raw(`bank`))
        .select('coa')
        .where('id', insertData.bankke_id)
        .first();

      const getCoaKredit = await trx
        .from(trx.raw(`bank`))
        .select('coa')
        .where('id', insertData.bankdari_id)
        .first();

      insertData.nobukti = nomorBukti;
      insertData.coadebet = getCoaDebet.coa;
      insertData.coakredit = getCoaKredit.coa;
      insertData.statusformat = getFormatPindahBuku.id;
      insertData.updated_at = this.utilsService.getTime();
      insertData.created_at = this.utilsService.getTime();
      console.log('insertData', insertData);

      Object.keys(insertData).forEach((key) => {
        if (typeof insertData[key] === 'string') {
          const value = insertData[key];
          const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

          if (dateRegex.test(value)) {
            insertData[key] = formatDateToSQL(value);
          } else if (this.uppercaseFields.includes(key)) {
            insertData[key] = insertData[key].toUpperCase();
          }
        }
      });

      const insertedData = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

      const jurnalPayload = {
        nobukti: nomorBukti,
        tglbukti: insertData.tglbukti,
        postingdari: getFormatPindahBuku.memo_nama,
        statusformat: getFormatPindahBuku.id,
        keterangan: insertData.keterangan,
        created_at: this.utilsService.getTime(),
        updated_at: this.utilsService.getTime(),
        modifiedby: insertData.modifiedby,
        details: [
          {
            id: '0',
            coa: insertData.coadebet,
            nobukti: nomorBukti,
            tglbukti: formatDateToSQL(insertData.tglbukti),
            keterangan: insertData.keterangan,
            nominaldebet: insertData.nominal,
            nominalkredit: '',
          },
          {
            id: '0',
            coa: insertData.coakredit,
            nobukti: nomorBukti,
            tglbukti: formatDateToSQL(insertData.tglbukti),
            keterangan: insertData.keterangan,
            nominaldebet: '',
            nominalkredit: insertData.nominal,
          },
        ],
      };

      const jurnalHeaderInserted = await this.jurnalUmumHeaderService.create(
        jurnalPayload,
        trx,
      );

      const newItem = insertedData[0];
      const { data, pagination } = await this.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false,
        },
        trx,
      );

      let dataIndex = data.findIndex((item) => item.id === newItem.id);
      if (dataIndex === -1) {
        dataIndex = 0;
      }

      // Optionally, you can find the page number or other info if needed
      const pageNumber = pagination?.currentPage;

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(data),
      );

      await this.logTrailService.create(
        {
          namatable: this.tableName,
          postingdari: 'ADD PINDAH BUKU',
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
        dataIndex,
      };
    } catch (error) {
      throw new Error(`Error creating pindah buku: ${error.message}`);
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

      const query = trx
        .from(trx.raw(`${this.tableName} as u`))
        .select([
          'u.id as id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.bankdari_id',
          'u.bankke_id',
          'u.coadebet',
          'u.coakredit',
          'u.alatbayar_id',
          'u.nowarkat',
          trx.raw("TO_CHAR(u.tgljatuhtempo, 'DD-MM-YYYY') as tgljatuhtempo"),
          'u.keterangan',
          'u.nominal',
          'u.statusformat',
          'u.modifiedby',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'bankdari.keterangan as bankdari_nama',
          'bankke.keterangan as bankke_nama',
          'coadebet.keterangancoa as coadebet_nama',
          'coakredit.keterangancoa as coakredit_nama',
          'p.keterangan as alatbayar_nama',
          // 'q.text as format_nama'
        ])
        .leftJoin('bank as bankdari', 'u.bankdari_id', 'bankdari.id')
        .leftJoin('bank as bankke', 'u.bankke_id', 'bankke.id')
        .leftJoin('akunpusat as coadebet', 'u.coadebet', 'coadebet.coa')
        .leftJoin('akunpusat as coakredit', 'u.coakredit', 'coakredit.coa')
        .leftJoin('alatbayar as p', 'u.alatbayar_id', 'p.id');
      // .leftJoin('parameter as q', 'u.statusformat', 'p.id');

      console.log('filters', filters, filters?.tglDari, filters?.tglSampai);

      if (filters?.tglDari && filters?.tglSampai) {
        const tglDariFormatted = formatDateToSQL(String(filters?.tglDari));
        const tglSampaiFormatted = formatDateToSQL(String(filters?.tglSampai));

        query.whereBetween('u.tglbukti', [
          tglDariFormatted,
          tglSampaiFormatted,
        ]);
      }

      if (search) {
        const sanitizedValue = String(search).replace(/\[/g, '[[]');
        query.where((builder) => {
          builder
            .orWhere('u.nobukti', 'like', `%${sanitizedValue}%`)
            .orWhereRaw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') LIKE ?", [
              `%${sanitizedValue}%`,
            ])
            .orWhere('bankdari.keterangan', 'like', `%${sanitizedValue}%`)
            .orWhere('bankke.keterangan', 'like', `%${sanitizedValue}%`)
            .orWhere('coadebet.keterangancoa', 'like', `%${sanitizedValue}%`)
            .orWhere('coakredit.keterangancoa', 'like', `%${sanitizedValue}%`)
            .orWhere('p.keterangan', 'like', `%${sanitizedValue}%`)
            .orWhere('u.nowarkat', 'like', `%${sanitizedValue}%`)
            .orWhereRaw("TO_CHAR(u.tgljatuhtempo, 'DD-MM-YYYY') LIKE ?", [
              `%${sanitizedValue}%`,
            ])
            .orWhere('u.keterangan', 'like', `%${sanitizedValue}%`)
            .orWhere('u.nominal', 'like', `%${sanitizedValue}%`)
            .orWhere('u.modifiedby', 'like', `%${sanitizedValue}%`)
            .orWhereRaw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
              `%${sanitizedValue}%`,
            ])
            .orWhereRaw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
              `%${sanitizedValue}%`,
            ]);
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          if (key === 'tglDari' || key === 'tglSampai') {
            continue; // Lewati filter jika key adalah 'tglDari' atau 'tglSampai'
          }

          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'tglbukti' || key === 'tgljatuhtempo') {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'coadebet_text') {
              query.andWhere(
                'coadebet.keterangancoa',
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'coakredit_text') {
              query.andWhere(
                'coakredit.keterangancoa',
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'bankdari_text') {
              query.andWhere(
                'bankdari.keterangan',
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'bankke_text') {
              query.andWhere(
                'bankke.keterangan',
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'alatbayar_text') {
              query.andWhere('p.keterangan', 'like', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }

      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      if (sort?.sortBy && sort?.sortDirection) {
        if (sort?.sortBy === 'bankdari_text') {
          query.orderBy('bankdari.keterangan', sort.sortDirection);
        } else if (sort?.sortBy === 'bankke_text') {
          query.orderBy('bankke.keterangan', sort.sortDirection);
        } else if (sort?.sortBy === 'coadebet_text') {
          query.orderBy('coadebet.keterangancoa', sort.sortDirection);
        } else if (sort?.sortBy === 'coakredit_text') {
          query.orderBy('coakredit.keterangancoa', sort.sortDirection);
        } else if (sort?.sortBy === 'alatbayar_text') {
          query.orderBy('p.keterangan', sort.sortDirection);
        } else {
          query.orderBy(sort.sortBy, sort.sortDirection);
        }
      }

      const result = await trx(this.tableName).count('id as total').first();
      const total = result?.total as number;
      const totalPages = Math.ceil(total / limit);
      const data = await query;
      console.log('data', data);
      const responseType = Number(total) > 500 ? 'json' : 'local';

      return {
        data: data,
        type: responseType,
        total,
        pagination: {
          currentPage: Number(page),
          totalPages: totalPages,
          totalItems: total,
          itemsPerPage: limit > 0 ? limit : total,
        },
      };
    } catch (error) {
      console.error('Error to findAll Pindah Buku', error);
      throw new Error(error);
    }
  }

  async findOne(id: string, trx: any) {
    try {
      const query = trx
        .from(trx.raw(`${this.tableName} as u`))
        .select([
          'u.id as id',
          'u.nobukti',
          trx.raw("TO_CHAR(u.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'u.bankdari_id',
          'u.bankke_id',
          'u.coadebet',
          'u.coakredit',
          'u.alatbayar_id',
          'u.nowarkat',
          trx.raw("TO_CHAR(u.tgljatuhtempo, 'DD-MM-YYYY') as tgljatuhtempo"),
          'u.keterangan',
          'u.nominal',
          'u.statusformat',
          'u.modifiedby',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'bankdari.keterangan as bankdari_nama',
          'bankke.keterangan as bankke_nama',
          'coadebet.keterangancoa as coadebet_nama',
          'coakredit.keterangancoa as coakredit_nama',
          'p.keterangan as alatbayar_nama',
        ])
        .leftJoin('bank as bankdari', 'u.bankdari_id', 'bankdari.id')
        .leftJoin('bank as bankke', 'u.bankke_id', 'bankke.id')
        .leftJoin('akunpusat as coadebet', 'u.coadebet', 'coadebet.coa')
        .leftJoin('akunpusat as coakredit', 'u.coakredit', 'coakredit.coa')
        .leftJoin('alatbayar as p', 'u.alatbayar_id', 'p.id')
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

  async update(id: string, data: any, trx: any) {
    try {
      const existingData = await trx(this.tableName).where('id', id).first();

      if (!existingData) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Data Not Found!',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        method,
        bankdari_nama,
        bankke_nama,
        alatbayar_nama,
        ...updateData
      } = data;

      const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
      const getFormatPindahBuku = await trx
        .from(trx.raw(`parameter`))
        .select([
          'id',
          'grp',
          'subgrp',
          trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') as memo_nama`),
        ])
        .where('grp', 'NOMOR PINDAH BUKU')
        .first();

      const getCoaDebet = await trx
        .from(trx.raw(`bank`))
        .select('coa')
        .where('id', updateData.bankke_id)
        .first();

      const getCoaKredit = await trx
        .from(trx.raw(`bank`))
        .select('coa')
        .where('id', updateData.bankdari_id)
        .first();

      updateData.coadebet = getCoaDebet.coa;
      updateData.coakredit = getCoaKredit.coa;

      Object.keys(updateData).forEach((key) => {
        if (typeof updateData[key] === 'string') {
          const value = updateData[key];
          const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

          if (dateRegex.test(value)) {
            updateData[key] = formatDateToSQL(value);
          } else {
            updateData[key] = updateData[key].toUpperCase();
          }
        }
      });
      console.log('updateData', updateData, updateData.nobukti);

      const hasChanges = this.utilsService.hasChanges(updateData, existingData);

      if (hasChanges) {
        updateData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(updateData);
      }

      const jurnalPayload = {
        nobukti: updateData.nobukti,
        tglbukti: updateData.tglbukti,
        postingdari: getFormatPindahBuku.memo_nama,
        statusformat: getFormatPindahBuku.id,
        keterangan: updateData.keterangan,
        created_at: this.utilsService.getTime(),
        updated_at: this.utilsService.getTime(),
        modifiedby: updateData.modifiedby,
        details: [
          {
            id: '0',
            coa: updateData.coadebet,
            nobukti: updateData.nobukti,
            tglbukti: formatDateToSQL(updateData.tglbukti),
            keterangan: updateData.keterangan,
            nominaldebet: updateData.nominal,
            nominalkredit: '',
          },
          {
            id: '0',
            coa: updateData.coakredit,
            nobukti: updateData.nobukti,
            tglbukti: formatDateToSQL(updateData.tglbukti),
            keterangan: updateData.keterangan,
            nominaldebet: '',
            nominalkredit: updateData.nominal,
          },
        ],
      };

      const getJurnal = await trx
        .from(trx.raw(`jurnalumumheader`))
        .where('nobukti', updateData.nobukti)
        .first();

      if (getJurnal) {
        const jurnalHeaderUpdated = await this.jurnalUmumHeaderService.update(
          getJurnal.id,
          jurnalPayload,
          trx,
        );
      } else {
        const jurnalHeaderInserted = await this.jurnalUmumHeaderService.create(
          jurnalPayload,
          trx,
        );
      }

      const { data: filteredData, pagination } = await this.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false,
        },
        trx,
      );

      let dataIndex = filteredData.findIndex(
        (item) => String(item.id) === String(id),
      );

      if (dataIndex === -1) {
        dataIndex = 0;
      }

      const itemsPerPage = limit || 30;
      const pageNumber = Math.floor(dataIndex / itemsPerPage) + 1;
      const endIndex = pageNumber * itemsPerPage;
      const limitedItems = filteredData.slice(0, endIndex);

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT PINDAH BUKU',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      return {
        newItems: {
          id,
          ...data,
        },
        pageNumber,
        dataIndex,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      console.error('Error updating pindah buku:', error);
      throw new Error('Failed to update pindah buku');
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

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE PINDAH BUKU',
          idtransss: id,
          nobuktitrans: id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby,
        },
        trx,
      );

      const getJurnal = await trx
        .from(trx.raw(`jurnalumumheader`))
        .where('nobukti', deletedData.nobukti)
        .first();

      if (getJurnal) {
        await this.jurnalUmumHeaderService.delete(
          getJurnal.id,
          trx,
          modifiedby,
        );
      }

      return {
        status: 200,
        message: 'Data deleted successfully',
        deletedData,
      };
    } catch (error) {
      console.error('Error deleting data: ', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
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
        return {
          status: 'success',
          message: 'Data aman untuk dihapus.',
        };
      }
    } catch (error) {
      console.error('Error di checkValidasi:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }

  async exportToExcel(data: any[], trx: any) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    // Header laporan
    worksheet.mergeCells('A1:F1'); // Ubah dari E1 ke D1 karena hanya 4 kolom
    worksheet.mergeCells('A2:F2'); // Ubah dari E2 ke D2 karena hanya 4 kolom
    worksheet.mergeCells('A3:F3'); // Ubah dari E3 ke D3 karena hanya 4 kolom

    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN PINDAH BUKU';
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
      const headerInfo = [
        ['No Bukti', h.nobukti ?? ''],
        ['Tanggal', h.tglbukti ?? ''],
        ['Mutasi Dari', h.bankdari_nama ?? ''],
        ['Mutasi Ke', h.bankke_nama ?? ''],
        ['Keterangan', h.keterangan ?? ''],
      ];

      const details = [
        {
          alatbayar: h.alatbayar_nama,
          tgljatuhtempo: h.tgljatuhtempo,
          nowarkat: h.nowarkat,
          keterangan: h.keterangan,
          nominal: h.nominal,
        },
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
        const tableHeaders = [
          'NO.',
          'ALAT BAYAR',
          'TGL JATUH TEMPO',
          'NO WARKAT',
          'KETERANGAN',
          'NOMINAL',
        ];

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
            d.alatbayar ?? '',
            d.tgljatuhtempo ?? '',
            d.nowarkat ?? '',
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

            if (colIndex === 5) {
              cell.value = Number(value);
              cell.numFmt = '#,##0.00'; // format angka dengan ribuan
              cell.alignment = {
                horizontal: 'right',
                vertical: 'middle',
              };
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

        worksheet.mergeCells(`A${currentRow}:E${currentRow}`);
        const totalLabelCell = worksheet.getCell(currentRow, 1);
        console.log('totalLabelCell', totalLabelCell);

        totalLabelCell.value = 'TOTAL';
        totalLabelCell.font = { bold: true, name: 'Tahoma', size: 10 };
        totalLabelCell.alignment = { horizontal: 'left', vertical: 'middle' };
        totalLabelCell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };

        const totalValueCell = worksheet.getCell(currentRow, 6);
        totalValueCell.value = totalNominal;
        totalValueCell.font = { bold: true, name: 'Tahoma', size: 10 };
        totalValueCell.alignment = { horizontal: 'right', vertical: 'middle' };
        totalValueCell.numFmt = '#,##0.00'; // format angka dengan ribuan
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
    worksheet.getColumn(4).width = 30;
    worksheet.getColumn(5).width = 40;
    worksheet.getColumn(6).width = 30;

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_pindahbuku${Date.now()}.xlsx`,
    );

    await workbook.xlsx.writeFile(tempFilePath);
    return tempFilePath;
  }
}
