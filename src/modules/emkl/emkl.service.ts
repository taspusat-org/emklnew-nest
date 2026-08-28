import {
  Inject,
  Injectable,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { CreateEmklDto } from './dto/create-emkl.dto';
import { RedisService } from 'src/common/redis/redis.service';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { RelasiService } from '../relasi/relasi.service';
import * as fs from 'fs';
import * as path from 'path';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { GlobalService } from '../global/global.service';
import { LocksService } from '../locks/locks.service';
import { Workbook } from 'exceljs';

@Injectable()
export class EmklService {
  private readonly tableName = 'emkl';
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly relasiService: RelasiService,
    private readonly globalService: GlobalService,
    private readonly locksService: LocksService,
  ) {}
  async create(createEmklDto: any, trx: any) {
    try {
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        statustrado_text,
        statusaktif_text,
        id,
        ...insertData
      } = createEmklDto;
      insertData.updated_at = this.utilsService.getTime();
      insertData.created_at = this.utilsService.getTime();

      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      [
        'nama',
        'contactperson',
        'alamat',
        'kota',
        'kodepos',
        'notelp',
        'email',
        'fax',
        'alamatweb',
        'npwp',
        'namapajak',
        'alamatpajak',
      ].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

      const statusRelasi = await trx('parameter')
        .select('*')
        .where('grp', 'STATUS RELASI')
        .where('text', 'EMKL')
        .first();

      const relasi = {
        nama: insertData.nama,
        statusrelasi: statusRelasi.id,
        coagiro: insertData.coagiro,
        coapiutang: insertData.coapiutang,
        coahutang: insertData.coahutang,
        alamat: insertData.alamat,
        npwp: insertData.npwp,
        namapajak: insertData.namapajak,
        alamatpajak: insertData.alamatpajak,
        statusaktif: insertData.statusaktif,
        modifiedby: insertData.modifiedby,
      };
      const dataRelasi = await this.relasiService.create(relasi, trx);

      const newItem = insertedItems[0];
      await trx(this.tableName)
        .update({
          relasi_id: dataRelasi.id,
        })
        .where('id', newItem.id)
        .returning('*');

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
      let itemIndex = data.findIndex(
        (item) => String(item.id) === String(newItem.id),
      );
      if (itemIndex === -1) {
        itemIndex = 0;
      }

      const pageNumber = Math.floor(itemIndex / limit) + 1;

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(data),
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD EMKL',
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
      throw new Error(`Error creating EMKL: ${error.message}`);
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
        const emklCountResult = await trx(this.tableName)
          .count('id as total')
          .first();

        const emklCount = emklCountResult?.total || 0;
        if (Number(emklCount) > 500) {
          return { data: { type: 'json' } };
        } else {
          limit = 0;
        }
      }

      const query = trx(`${this.tableName} as emkl`)
        .select([
          'emkl.id as id',
          'emkl.nama',
          'emkl.contactperson',
          'emkl.alamat',
          'emkl.coagiro',
          'emkl.coapiutang',
          'emkl.coahutang',
          'emkl.kota',
          'emkl.kodepos',
          'emkl.notelp',
          'emkl.email',
          'emkl.fax',
          'emkl.alamatweb',
          'emkl.top',
          'emkl.npwp',
          'emkl.namapajak',
          'emkl.alamatpajak',
          'emkl.statustrado',
          'emkl.statusaktif',
          'emkl.modifiedby',
          trx.raw(
            "TO_CHAR(emkl.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(emkl.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
          'statusaktif.memo as statusaktif_memo',
          'statusaktif.text as statusaktif_text',
          'statustrado.memo as statustrado_memo',
          'statustrado.text as statustrado_text',
          'coagiro.keterangancoa as coagiro_ket',
          'coapiutang.keterangancoa as coapiutang_ket',
          'coahutang.keterangancoa as coahutang_ket',
        ])
        .leftJoin('akunpusat as coagiro', 'emkl.coagiro', 'coagiro.coa')
        .leftJoin(
          'akunpusat as coapiutang',
          'emkl.coapiutang',
          'coapiutang.coa',
        )
        .leftJoin('akunpusat as coahutang', 'emkl.coahutang', 'coahutang.coa')
        .leftJoin(
          'parameter as statustrado',
          'emkl.statustrado',
          'statustrado.id',
        )
        .leftJoin(
          'parameter as statusaktif',
          'emkl.statusaktif',
          'statusaktif.id',
        );

      const excludeSearchKeys = ['statustrado', 'statusaktif'];

      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      if (search) {
        const sanitizedValue = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (['created_at', 'updated_at'].includes(field)) {
              qb.orWhereRaw("TO_CHAR(emkl.??, 'DD-MM-YYYY HH24:MI:SS') like ?", [
                field,
                `%${sanitizedValue}%`,
              ]);
            } else if (field === 'statusaktif_memo') {
              qb.orWhere('statusaktif.memo', 'like', `%${sanitizedValue}%`);
            } else if (field === 'statusaktif_text') {
              qb.orWhere('statusaktif.text', 'like', `%${sanitizedValue}%`);
            } else if (field === 'statustrado_memo') {
              qb.orWhere('statustrado.memo', 'like', `%${sanitizedValue}%`);
            } else if (field === 'statustrado_text') {
              qb.orWhere('statustrado.text', 'like', `%${sanitizedValue}%`);
            } else if (field === 'coagiro_ket') {
              qb.orWhere(
                'coagiro.keterangancoa',
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (field === 'coapiutang_ket') {
              qb.orWhere(
                'coapiutang.keterangancoa',
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (field === 'coahutang_ket') {
              qb.orWhere(
                'coahutang.keterangancoa',
                'like',
                `%${sanitizedValue}%`,
              );
            } else {
              qb.orWhere(`emkl.${field}`, 'like', `%${sanitizedValue}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');
          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw(
                "TO_CHAR(emkl.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?",
                [key, `%${sanitizedValue}%`],
              );
            } else if (key === 'statusaktif_text') {
              query.andWhere(`statusaktif.text`, '=', sanitizedValue);
            } else if (key === 'statustrado_text') {
              query.andWhere(`statustrado.text`, '=', sanitizedValue);
            } else if (key === 'coagiro_ket') {
              query.andWhere(
                `coagiro.keterangancoa`,
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'coahutang_ket') {
              query.andWhere(
                `coahutang.keterangancoa`,
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (key === 'coapiutang_ket') {
              query.andWhere(
                `coapiutang.keterangancoa`,
                'like',
                `%${sanitizedValue}%`,
              );
            } else {
              query.andWhere(`emkl.${key}`, 'like', `%${sanitizedValue}%`);
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

  async getById(id: string, trx: any) {
    try {
      const result = await trx(this.tableName).where('id', id).first();

      if (!result) {
        throw new Error('Data not found');
      }

      return result;
    } catch (error) {
      console.error('Error fetching data by id:', error);
      throw new Error('Failed to fetch data by id');
    }
  }

  async update(dataId: string, data: any, trx: any) {
    try {
      const existingData = await trx(this.tableName)
        .where('id', dataId)
        .first();

      if (!existingData) {
        throw new Error('Emkl not found');
      }

      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        statustrado_text,
        statusaktif_text,
        coagiro_ket,
        coahutang_ket,
        coapiutang_ket,
        id,
        ...insertData
      } = data;
      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      [
        'nama',
        'contactperson',
        'alamat',
        'kota',
        'kodepos',
        'notelp',
        'email',
        'fax',
        'alamatweb',
        'npwp',
        'namapajak',
        'alamatpajak',
      ].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });
      const hasChanges = this.utilsService.hasChanges(insertData, existingData);
      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', dataId).update(insertData);
      }

      const { data: filteredData, pagination } = await this.findAll(
        {
          search,
          filters,
          pagination: { page, limit: 0 },
          sort: { sortBy, sortDirection },
          isLookUp: false, // Set based on your requirement (e.g., lookup flag)
        },
        trx,
      );

      // Cari index item yang baru saja diupdate
      let itemIndex = filteredData.findIndex(
        (item) => String(item.id) === String(dataId),
      );
      if (itemIndex === -1) {
        itemIndex = 0;
      }
      const statusRelasi = await trx('parameter')
        .select('*')
        .where('grp', 'STATUS RELASI')
        .where('text', 'EMKL')
        .first();
      const relasi = {
        nama: insertData.nama,
        statusrelasi: statusRelasi.id,
        coagiro: insertData.coagiro,
        coapiutang: insertData.coapiutang,
        coahutang: insertData.coahutang,
        alamat: insertData.alamat,
        npwp: insertData.npwp,
        namapajak: insertData.namapajak,
        alamatpajak: insertData.alamatpajak,
        statusaktif: insertData.statusaktif,
        modifiedby: insertData.modifiedby,
      };
      const dataRelasi = await this.relasiService.update(
        existingData.relasi_id,
        relasi,
        trx,
      );
      const itemsPerPage = limit || 10; // Default 10 items per page, atau yang dikirimkan dari frontend
      const pageNumber = Math.floor(itemIndex / itemsPerPage) + 1;

      // Ambil data hingga halaman yang mencakup item yang baru diperbarui
      const endIndex = pageNumber * itemsPerPage;
      const limitedItems = filteredData.slice(0, endIndex);
      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT EMKL',
          idtrans: dataId,
          nobuktitrans: dataId,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      return {
        updatedItem: {
          dataId,
          ...data,
        },
        pageNumber,
        itemIndex,
      };
    } catch (error) {
      console.error('Error updating emkl:', error);
      throw new Error('Failed to update emkl');
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
          postingdari: 'DELETE EMKL',
          idtrans: deletedData.id,
          nobuktitrans: deletedData.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby,
        },
        trx,
      );

      const dataRelasi = await this.relasiService.delete(
        deletedData.relasi_id,
        trx,
        modifiedby,
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

  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:I1');
    worksheet.mergeCells('A2:I2');
    worksheet.mergeCells('A3:I3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN EMKL';
    worksheet.getCell('A3').value = 'Data Export';
    worksheet.getCell('A1').alignment = {
      horizontal: 'center',
      vertical: 'middle',
    };
    worksheet.getCell('A2').alignment = {
      horizontal: 'center',
      vertical: 'middle',
    };
    worksheet.getCell('A3').alignment = {
      horizontal: 'center',
      vertical: 'middle',
    };
    worksheet.getCell('A1').font = { size: 14, bold: true };
    worksheet.getCell('A2').font = { bold: true };
    worksheet.getCell('A3').font = { bold: true };

    const headers = [
      'NO.',
      'NAMA',
      'CONTACT PERSON',
      'ALAMAT',
      'KOTA',
      'KODE POS',
      'NO TELP',
      'EMAIL',
      'FAX',
      'ALAMAT WEB',
      'TOP',
      'NPWP',
      'NAMA PAJAK',
      'ALAMAT PAJAK',
      'COA GIRO',
      'COA PIUTANG',
      'COA HUTANG',
      'STATUS TRADO',
      'STATUS AKTIF',
    ];
    headers.forEach((header, index) => {
      const cell = worksheet.getCell(5, index + 1);
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
    data.forEach((row, rowIndex) => {
      const currentRow = rowIndex + 6;

      worksheet.getCell(currentRow, 1).value = rowIndex + 1;
      worksheet.getCell(currentRow, 2).value = row.nama;
      worksheet.getCell(currentRow, 3).value = row.contactperson;
      worksheet.getCell(currentRow, 4).value = row.alamat;
      worksheet.getCell(currentRow, 5).value = row.kota;
      worksheet.getCell(currentRow, 6).value = row.kodepos;
      worksheet.getCell(currentRow, 7).value = row.notelp;
      worksheet.getCell(currentRow, 8).value = row.email;
      worksheet.getCell(currentRow, 9).value = row.fax;
      worksheet.getCell(currentRow, 10).value = row.alamatweb;
      worksheet.getCell(currentRow, 11).value = row.top;
      worksheet.getCell(currentRow, 12).value = row.npwp;
      worksheet.getCell(currentRow, 13).value = row.namapajak;
      worksheet.getCell(currentRow, 14).value = row.alamatpajak;
      worksheet.getCell(currentRow, 15).value = row.coagiro_ket;
      worksheet.getCell(currentRow, 16).value = row.coapiutang_ket;
      worksheet.getCell(currentRow, 17).value = row.coahutang_ket;
      worksheet.getCell(currentRow, 18).value = row.statustrado_text;
      worksheet.getCell(currentRow, 19).value = row.statusaktif_text;

      for (let col = 1; col <= headers.length; col++) {
        const cell = worksheet.getCell(currentRow, col);
        if (col == 11) {
          worksheet.getCell(currentRow, col).alignment = {
            horizontal: 'right',
          };
        }
        cell.font = { name: 'Tahoma', size: 10 };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      }
    });

    worksheet.getColumn(1).width = 10;
    worksheet.getColumn(2).width = 30;
    worksheet.getColumn(3).width = 20;
    worksheet.getColumn(4).width = 30;
    worksheet.getColumn(5).width = 30;
    worksheet.getColumn(6).width = 15;
    worksheet.getColumn(7).width = 30;
    worksheet.getColumn(8).width = 30;
    worksheet.getColumn(9).width = 30;
    worksheet.getColumn(10).width = 30;
    worksheet.getColumn(11).width = 15;
    worksheet.getColumn(12).width = 30;
    worksheet.getColumn(13).width = 30;
    worksheet.getColumn(14).width = 30;
    worksheet.getColumn(15).width = 30;
    worksheet.getColumn(16).width = 30;
    worksheet.getColumn(17).width = 30;
    worksheet.getColumn(18).width = 30;
    worksheet.getColumn(19).width = 30;

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_emkl${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
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
        const emklData = await trx(this.tableName).where('id', value).first();
        if (!emklData) {
          return { status: 'success', message: 'Data aman untuk dihapus.' };
        }

        // Cek emkl.id dipakai transaksi (hargatrucking, orderanmuatan, dll) ATAU
        // relasinya dipakai transaksi. Untuk relasi, kecualikan tabel `emkl`
        // (self-reference yang ikut terhapus saat delete).
        let used = await this.utilsService.findFirstReference(
          this.tableName,
          value,
          trx,
        );
        if (!used && emklData.relasi_id) {
          used = await this.utilsService.findFirstReference(
            'relasi',
            emklData.relasi_id,
            trx,
            [this.tableName],
          );
        }
        if (used) {
          return {
            status: 'failed',
            message: `Data tidak dapat dihapus karena masih digunakan pada tabel ${used.ref_table}.`,
          };
        }

        return { status: 'success', message: 'Data aman untuk dihapus.' };
      }
    } catch (error) {
      console.error('Error di checkValidasi:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }
}
