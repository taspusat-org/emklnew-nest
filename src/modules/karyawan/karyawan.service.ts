import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateKaryawanDto } from './dto/create-karyawan.dto';
import { RedisService } from 'src/common/redis/redis.service';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { ParameterService } from '../parameter/parameter.service';
import { LocksService } from '../locks/locks.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { Workbook } from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Kolom `karyawan.karyawan_id` punya FK self-reference ke `karyawan(id)` yang
 * sebenarnya artefak migrasi — maksud aslinya menunjuk tabel karyawan di server
 * HR terpisah. Seluruh baris lama memakai sentinel '0' yang tak pernah ada di
 * tabel; constraint-nya NOT VALID sehingga baris lama lolos, TAPI setiap
 * insert/update baru diperiksa → "violates foreign key constraint" (500).
 * Sentinel dan string kosong diperlakukan sebagai "tak ada tautan HR" = NULL,
 * satu-satunya nilai yang lolos FK. Baris lama ikut bersih saat diedit.
 */
async function resolveKaryawanId(trx: any, value: any): Promise<string | null> {
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (!normalized || normalized === '0') {
    return null;
  }
  // Nilai apa pun yang tidak benar-benar ada di karyawan(id) akan ditolak FK
  // dan menggagalkan seluruh simpan. Karena kolom ini tak punya sumber data
  // yang bisa dipilih user (server HR tak tersedia), nilai asing dibuang
  // menjadi NULL alih-alih meledak jadi 500.
  const existing = await trx('karyawan').where('id', normalized).first();
  return existing ? normalized : null;
}

@Injectable()
export class KaryawanService {
  private readonly tableName = 'karyawan';
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
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
        karyawan_nama,
        jabatan_nama,
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
      ['kodeabsen', 'nama', 'keterangan'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      insertData.karyawan_id = await resolveKaryawanId(trx, insertData.karyawan_id);

      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

      const newItem = insertedItems[0];
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

      let itemIndex = data.findIndex((item) => item.id === newItem.id);
      if (itemIndex === -1) {
        itemIndex = 0;
      }

      const pageNumber = pagination?.currentPage;

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(data),
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD KARYAWAN',
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
      throw new Error(`Error creating karyawan: ${error.message}`);
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
        const karyawanCountResult = await trx(this.tableName)
          .count('id as total')
          .first();

        const karyawanCount = karyawanCountResult?.total || 0;
        if (Number(karyawanCount) > 500) {
          return { data: { type: 'json' } };
        } else {
          limit = 0;
        }
      }

      const query = trx(`${this.tableName} as kar`)
        .select([
          'kar.id as id',
          'kar.nama',
          'kar.keterangan',
          'kar.statusaktif',
          'kar.modifiedby',
          'kar.kodeabsen',
          'kar.absen_id',
          'kar.jabatan_id',
          'kar.karyawan_id',
          'hrk.nama as karyawan_nama',
          trx.raw(
            "TO_CHAR(kar.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(kar.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
          'par.memo as statusaktif_memo',
          'par.text as statusaktif_text',
          'jabatan.nama as jabatan_nama',
        ])
        .leftJoin('jabatan', 'kar.jabatan_id', 'jabatan.id')
        // karyawan = tabel LOKAL (emkl), sama seperti marketing.service.ts.
        // Join lintas DB `hr.dbo.karyawan` melempar "cross-database references
        // are not implemented" di PG (server HR terpisah, DB `hr` tak ada) → 500.
        .leftJoin(`${this.tableName} as hrk`, 'kar.karyawan_id', 'hrk.id')
        .leftJoin('parameter as par', 'kar.statusaktif', 'par.id');

      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      if (search) {
        const sanitizedValue = String(search).replace(/\[/g, '[[]');
        query.where((builder) => {
          builder
            // ilike, bukan like: di PG `like` case-sensitive sedangkan seluruh
            // data tersimpan huruf besar → ketikan huruf kecil tak pernah cocok
            .orWhere('kar.nama', 'ilike', `%${sanitizedValue}%`)
            .orWhere('kar.keterangan', 'ilike', `%${sanitizedValue}%`)
            .orWhere('kar.kodeabsen', 'ilike', `%${sanitizedValue}%`)
            .orWhere('kar.modifiedby', 'ilike', `%${sanitizedValue}%`)
            .orWhere('jabatan.nama', 'ilike', `%${sanitizedValue}%`);
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');
          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw(
                "TO_CHAR(kar.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?",
                [key, `%${sanitizedValue}%`],
              );
            } else if (key === 'text' || key === 'memo') {
              query.andWhere(`par.${key}`, '=', sanitizedValue);
            } else if (key === 'jabatan_nama') {
              query.andWhere(`jabatan.nama`, 'ilike', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`kar.${key}`, 'ilike', `%${sanitizedValue}%`);
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
        karyawan_nama,
        jabatan_nama,
        id,
        ...insertData
      } = data;
      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['kodeabsen', 'nama', 'keterangan'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      insertData.karyawan_id = await resolveKaryawanId(trx, insertData.karyawan_id);

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
      // id karyawan uuid string: Number(uuid) = NaN dan NaN !== NaN, jadi
      // perbandingan numerik selalu -1 → "Updated item not found" → 500
      const itemIndex = filteredData.findIndex(
        (item) => String(item.id) === String(dataId),
      );
      if (itemIndex === -1) {
        throw new Error('Updated item not found in all items');
      }
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
          postingdari: 'EDIT KARYAWAN',
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
      console.error('Error updating karyawan:', error);
      throw new Error('Failed to update karyawan');
    }
  }

  async delete(id: string, trx: any, modifiedby: string) {
    try {
      // Karyawan direferensikan marketing, pengeluaranemklheader,
      // pengeluaranemklgantungheader, dll. Tanpa pra-cek ini, menghapus data
      // yang masih dipakai hanya memunculkan 500 "Failed to delete karyawan"
      // dari pelanggaran FK, tanpa petunjuk tabel mana yang menahannya.
      const usedBy = await this.utilsService.findFirstReference(
        this.tableName,
        id,
        trx,
      );
      if (usedBy) {
        throw new BadRequestException(
          `Karyawan tidak bisa dihapus karena masih dipakai di tabel ${usedBy.ref_table} (kolom ${usedBy.ref_column}).`,
        );
      }

      const deletedData = await this.utilsService.lockAndDestroy(
        id,
        this.tableName,
        'id',
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE KARYAWAN',
          idtrans: deletedData.id,
          nobuktitrans: deletedData.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby,
        },
        trx,
      );

      return { status: 200, message: 'Data deleted successfully', deletedData };
    } catch (error) {
      console.error('Error deleting data:', error);
      // HttpException (mis. BadRequestException "masih dipakai") harus lolos
      // apa adanya, kalau tidak pesannya tertelan jadi 500 generik
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
    worksheet.getCell('A2').value = 'LAPORAN KARYAWAN';
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

    const headers = ['NO.', 'NAMA', 'KETERANGAN', 'JABATAN', 'STATUS AKTIF'];
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
      worksheet.getCell(currentRow, 4).value = row.jabatan_nama;
      worksheet.getCell(currentRow, 5).value = row.statusaktif_text;

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
    worksheet.getColumn(4).width = 30;
    worksheet.getColumn(5).width = 20;

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_karyawan${Date.now()}.xlsx`,
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
        const getRelasi = await trx(this.tableName).where('id', value).first();
        const validasi = {
          status: 'success',
          message: 'Data aman untuk dihapus.',
        };
        // const validasi = await this.globalService.checkUsed(
        //   'pengeluaranheader',
        //   'relasi_id',
        //   getRelasi.relasi_id,
        //   trx,
        // );

        return validasi;
      }
    } catch (error) {
      console.error('Error di checkValidasi:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }
}
