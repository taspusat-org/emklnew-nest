import {
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { CreatePelayaranDto } from './dto/create-pelayaran.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { RedisService } from 'src/common/redis/redis.service';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { dbMssql } from 'src/common/utils/db';
import * as fs from 'fs';
import * as path from 'path';
import { Workbook } from 'exceljs';
import { RelasiService } from '../relasi/relasi.service';
import { ParameterService } from '../parameter/parameter.service';
// import { GlobalService } from '../global/global.service';
import { LocksService } from '../locks/locks.service';

@Injectable()
export class PelayaranService {
  private readonly tableName = 'pelayaran';
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly relasiService: RelasiService,
    private readonly parameterService: ParameterService,
    // private readonly globalService: GlobalService,
    private readonly locksService: LocksService,
  ) {}
  async create(createPelayaranDto: any, trx: any) {
    try {
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        statusaktif_text,
        id,
        ...insertData
      } = createPelayaranDto;
      insertData.updated_at = this.utilsService.getTime();
      insertData.created_at = this.utilsService.getTime();

      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['nama', 'keterangan'].forEach((field) => {
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
        .where('text', 'PELAYARAN')
        .first();

      const relasi = {
        nama: insertData.nama,
        statusrelasi: statusRelasi.id,
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
          postingdari: 'ADD PELAYARAN',
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
      throw new Error(`Error creating pelayaran: ${error.message}`);
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
        const pelayaranCountResult = await trx(this.tableName)
          .count('id as total')
          .first();

        const pelayaranCount = pelayaranCountResult?.total || 0;
        if (Number(pelayaranCount) > 500) {
          return { data: { type: 'json' } };
        } else {
          limit = 0;
        }
      }

      const query = trx
        .from(`${this.tableName} as pel`)
        .select([
          'pel.id as id',
          'pel.nama',
          'pel.keterangan',
          'pel.statusaktif',
          'pel.modifiedby',
          trx.raw(
            "TO_CHAR(pel.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(pel.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
          'par.memo',
          'par.text as statusaktif_text',
        ])
        .leftJoin(
          trx.raw('parameter as par'),
          'pel.statusaktif',
          'par.id',
        );

      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }
      const excludeSearchKeys = ['statusaktif', 'text', 'icon'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );
      if (search) {
        const sanitizedValue = String(search);

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (['created_at', 'updated_at'].includes(field)) {
              qb.orWhereRaw("TO_CHAR(pel.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
                field,
                `%${sanitizedValue}%`,
              ]);
            } else {
              qb.orWhere(`pel.${field}`, 'ilike', `%${sanitizedValue}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value);
          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw(
                "TO_CHAR(pel.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?",
                [key, `%${sanitizedValue}%`],
              );
            } else if (key === 'text' || key === 'memo') {
              query.andWhere(`par.${key}`, '=', sanitizedValue);
            } else {
              query.andWhere(`pel.${key}`, 'ilike', `%${sanitizedValue}%`);
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

  async findAllByIds(ids: { id: string }[]) {
    try {
      const idList = ids.map((item) => item.id);

      const query = dbMssql(`${this.tableName} as pel`)
        .select([
          'pel.id as id',
          'pel.nama',
          'pel.keterangan',
          'pel.statusaktif',
          'pel.modifiedby',
          dbMssql.raw(
            "TO_CHAR(pel.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          dbMssql.raw(
            "TO_CHAR(pel.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
          'par.memo',
          'par.text',
        ])
        .leftJoin('parameter as par', 'pel.statusaktif', 'par.id')
        .whereIn('pel.id', idList)

        .orderBy('pel.nama', 'ASC');

      const data = await query;


      return data;
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
        throw new Error('Pelayaran not found');
      }

      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        statusaktif_text,
        id,
        ...insertData
      } = data;
      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['nama', 'keterangan'].forEach((field) => {
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
        .where('text', 'PELAYARAN')
        .first();
      const relasi = {
        nama: insertData.nama,
        statusrelasi: statusRelasi.id,
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
          postingdari: 'EDIT PELAYARAN',
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
      console.error('Error updating pelayaran:', error);
      throw new Error('Failed to update pelayaran oye');
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
          postingdari: 'DELETE PELAYARAN',
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
    worksheet.getCell('A2').value = 'LAPORAN PELAYARAN';
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

    const headers = ['NO.', 'NAMA', 'KETERANGAN', 'STATUS AKTIF'];
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
      worksheet.getCell(currentRow, 3).value = row.keterangan;
      worksheet.getCell(currentRow, 4).value = row.statusaktif_text;

      for (let col = 1; col <= headers.length; col++) {
        const cell = worksheet.getCell(currentRow, col);
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
    worksheet.getColumn(3).width = 30;
    worksheet.getColumn(4).width = 20;

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_menu${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }
  async approval(data: any, trx: any) {
    try {
      if (data.text === 'AKTIF') {
        const checkValidation = await trx(this.tableName)
          .whereIn('id', data.transaksi_id)
          .andWhere('statusaktif', data.value);

        if (checkValidation && checkValidation.length > 0) {
          // Ambil semua nama yg sudah aktif
          const namaList = checkValidation
            .map((row: any) => row.nama)
            .join(', ');
          return {
            status: HttpStatus.BAD_REQUEST,
            message: `Data ${namaList} sudah berstatus AKTIF. Proses tidak bisa dilanjutkan`,
          };
        }
        await trx(this.tableName)
          .update({ statusaktif: data.value })
          .whereIn('id', data.transaksi_id);
      }

      return {
        status: HttpStatus.OK,
        message: 'Proses non approval berhasil dijalankan.',
      };
    } catch (error) {
      console.error('Error deleting data:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }
  async nonApproval(data: any, trx: any) {
    try {
      if (data.text === 'AKTIF') {
        const checkValidation = await trx(this.tableName)
          .whereIn('id', data.transaksi_id)
          .andWhere('statusaktif', data.value)
          .select('nama');
        if (checkValidation && checkValidation.length > 0) {
          // Data sudah berstatus NON AKTIF (alias status sama), maka hentikan proses
          const namaList = checkValidation
            .map((row: any) => row.nama)
            .join(', ');
          return {
            status: HttpStatus.BAD_REQUEST,
            message: `Data ${namaList} sudah berstatus NON AKTIF. Proses tidak bisa dilanjutkan.`,
          };
        }
        // Jika data valid untuk di-non-approve, update statusaktif-nya
        await trx(this.tableName)
          .whereIn('id', data.transaksi_id)
          .update({ statusaktif: data.value });
      }
      // Bisa tambahkan log trail di sini jika diperlukan, tinggal di-uncomment dan sesuaikan variabelnya
      return {
        status: HttpStatus.OK,
        message: 'Proses non approval berhasil dijalankan.',
      };
    } catch (error) {
      console.error('Error in nonApproval:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to process non approval');
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
        const getRelasi = await trx(this.tableName).where('id', value).first();
        if (!getRelasi) {
          return { status: 'success', message: 'Data aman untuk dihapus.' };
        }

        // Cek apakah pelayaran / relasinya masih dipakai transaksi lain sebelum
        // menghapus. Delete menghapus baris pelayaran dulu lalu baris relasi-nya,
        // jadi untuk relasi kita KECUALIKAN tabel `pelayaran` (self-reference yang
        // ikut terhapus). Kalau masih dipakai, blokir dengan pesan ramah — kalau
        // dipaksa, delete relasi akan kena FK violation → 500.
        let used = await this.utilsService.findFirstReference('pelayaran', value, trx);
        if (!used && getRelasi.relasi_id) {
          used = await this.utilsService.findFirstReference('relasi', getRelasi.relasi_id, trx, [
            'pelayaran',
          ]);
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
