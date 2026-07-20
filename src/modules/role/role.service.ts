import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { dbMssql } from 'src/common/utils/db';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { RedisService } from 'src/common/redis/redis.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { Workbook } from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
@Injectable()
export class RoleService {
  private readonly tableName = 'role';
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  async create(data: any, trx: any) {
    try {
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        ...insertData
      } = data;
      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['rolename'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });
      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

      const newItem = insertedItems[0];

      // Siapkan query dasar
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.rolename',
          'u.statusaktif',
          'u.modifiedby',
          dbMssql.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at",
          ),
          dbMssql.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at",
          ),
          'p.memo',
          'p.text',
        ])
        .leftJoin('parameter as p', 'u.statusaktif', 'p.id')
        .orderBy(sortBy ? `u.${sortBy}` : 'u.id', sortDirection || 'desc')
        .where('u.id', '<=', newItem.id); // Filter berdasarkan ID yang lebih kecil atau sama dengan newItem.id

      // Terapkan filtering tambahan jika ada
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${value}%`,
              ]);
            } else if (key === 'text' || key === 'memo') {
              query.andWhere(`p.${key}`, '=', value);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${value}%`);
            }
          }
        }
      }

      // Perbaikan bagian search

      if (search) {
        query.where((builder) => {
          builder

            .orWhere('u.rolename', 'like', `%${search}%`)

            .orWhere('p.memo', 'like', `%${search}%`)
            .orWhere('p.text', 'like', `%${search}%`);
        });
      }

      // Ambil hasil query yang terfilter
      const filteredItems = await query;

      // Cari index item baru di hasil yang sudah difilter
      const itemIndex = filteredItems.findIndex(
        (item) => item.id === newItem.id,
      );

      if (itemIndex === -1) {
        throw new Error('Item baru tidak ditemukan di hasil pencarian');
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
          postingdari: 'ADD ROLE',
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
      throw new Error(`Error creating menu: ${error.message}`);
    }
  }
  async findAllByIds(ids: { id: string }[]) {
    try {
      const idList = ids.map((item) => item.id);
      const tempData = `##temp_${Math.random().toString(36).substring(2, 15)}`;

      const createTempTableQuery = `
        CREATE TABLE ${tempData} (
          id NVARCHAR(100)
        );
      `;
      await dbMssql.raw(createTempTableQuery);

      const insertTempTableQuery = `
        INSERT INTO ${tempData} (id)
        VALUES ${idList.map((id) => `('${id}')`).join(', ')};
      `;
      await dbMssql.raw(insertTempTableQuery);

      const query = dbMssql('role as u')
        .select([
          'u.id as id',
          'u.rolename',
          'u.statusaktif',
          'u.modifiedby',
          dbMssql.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at",
          ),
          dbMssql.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at",
          ),
          'p.memo',
          'p.text',
        ])
        .join('parameter as p', 'u.statusaktif', 'p.id')
        .join(dbMssql.raw(`${tempData} as temp`), 'u.id', 'temp.id')
        .orderBy('u.rolename', 'ASC');

      const data = await query;

      const dropTempTableQuery = `DROP TABLE ${tempData};`;
      await dbMssql.raw(dropTempTableQuery);

      return data;
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }
  async findAll({ search, filters, pagination, sort }: FindAllParams) {
    try {
      let { page, limit } = pagination ?? {};

      // Default page dan limit
      page = page ?? 1;
      limit = limit ?? 0;

      const query = dbMssql(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.rolename',
          'u.statusaktif',
          'u.modifiedby',
          dbMssql.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at",
          ),
          dbMssql.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at",
          ),
          'p.memo',
          'p.text',
        ])
        .leftJoin('parameter as p', 'u.statusaktif', 'p.id');

      // Jika limit ada dan bukan 0, terapkan pagination
      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      if (search) {
        query.where((builder) => {
          builder

            .orWhere('u.rolename', 'like', `%${search}%`)

            .orWhere('p.memo', 'like', `%${search}%`)
            .orWhere('p.text', 'like', `%${search}%`);
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${value}%`,
              ]);
            } else if (key === 'text' || key === 'memo') {
              query.andWhere(`p.${key}`, '=', value);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${value}%`);
            }
          }
        }
      }

      const result = await dbMssql(this.tableName).count('id as total').first();
      const total = result?.total as number;

      // Jika limit ada, hitung total pages berdasarkan limit
      const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }

      const data = await query;

      return {
        data: data,
        total,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems: total,
          itemsPerPage: limit > 0 ? limit : total, // Jika limit tidak ada, return semua data
        },
      };
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async checkRole(id: string) {
    try {
      const roleUsage = await dbMssql('userrole')
        .where({ role_id: id })
        .select('role_id');

      return roleUsage.length > 0;
    } catch (error) {
      console.error('Error in processCheckRole:', error);
      throw new Error('Failed to check role usage');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      const existingData = await trx(this.tableName).where('id', id).first();

      if (!existingData) {
        throw new Error('Data not found');
      }
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        statusaktif_text,
        ...updateData
      } = data;
      Object.keys(updateData).forEach((key) => {
        if (typeof updateData[key] === 'string') {
          updateData[key] = updateData[key].toUpperCase();
        }
      });
      const hasChanges = this.utilsService.hasChanges(updateData, existingData);

      if (hasChanges) {
        updateData.updated_at = this.utilsService.getTime();

        await trx(this.tableName).where('id', id).update(updateData);
      }

      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.rolename',
          'u.statusaktif',
          'u.modifiedby',
          dbMssql.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at",
          ),
          dbMssql.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at",
          ),
          'p.memo',
          'p.text',
        ])
        .join('parameter as p', 'u.statusaktif', 'p.id')
        .orderBy(sortBy ? `u.${sortBy}` : 'u.id', sortDirection || 'desc')
        .where('u.id', '<=', id); // Filter berdasarkan ID yang lebih kecil atau sama dengan newItem.id

      // Terapkan filtering tambahan jika ada
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${value}%`,
              ]);
            } else if (key === 'text' || key === 'memo') {
              query.andWhere(`p.${key}`, '=', value);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${value}%`);
            }
          }
        }
      }

      // Perbaikan bagian search

      if (search) {
        query.where((builder) => {
          builder

            .orWhere('u.rolename', 'like', `%${search}%`)

            .orWhere('p.memo', 'like', `%${search}%`)
            .orWhere('p.text', 'like', `%${search}%`);
        });
      }
      const allItems = await query;
      // Cari index item yang baru saja diupdate
      const itemIndex = allItems.findIndex((item) => item.id === id);

      if (itemIndex === -1) {
        throw new Error('Updated item not found in all items');
      }

      const pageNumber = Math.floor(itemIndex / limit) + 1;

      // Ambil data hingga halaman yang mencakup item yang baru diperbarui
      const endIndex = pageNumber * limit;
      const limitedItems = allItems.slice(0, endIndex);
      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );
      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT ROLE',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );
      return {
        newItem: {
          id,
          ...data,
        },
        pageNumber,
        itemIndex,
      };
    } catch (error) {
      console.error('Error updating menu:', error);
      throw new Error('Failed to update menu');
    }
  }

  async getById(id: string, trx: any) {
    try {
      // Fetch data by id from the database table
      const result = await trx(this.tableName).where('id', id).first();

      // Check if data is found
      if (!result) {
        throw new Error('Data not found');
      }

      return result;
    } catch (error) {
      console.error('Error fetching data by id:', error);
      throw new Error('Failed to fetch data by id');
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
          postingdari: 'DELETE ROLE',
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
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }
  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    // Header export
    worksheet.mergeCells('A1:F1');
    worksheet.mergeCells('A2:F2');
    worksheet.mergeCells('A3:F3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN ROLE';
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

    // Mendefinisikan header kolom
    const headers = ['No.', 'NAMA ROLE', 'MODIFIED BY', 'CREATED AT'];
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

    // Mengisi data ke dalam Excel dengan nomor urut sebagai ID
    data.forEach((row, rowIndex) => {
      worksheet.getCell(rowIndex + 6, 1).value = rowIndex + 1; // Nomor urut (ID)
      worksheet.getCell(rowIndex + 6, 2).value = row.rolename;
      worksheet.getCell(rowIndex + 6, 3).value = row.modifiedby;
      worksheet.getCell(rowIndex + 6, 4).value = row.created_at;

      // Menambahkan border untuk setiap cell
      for (let col = 1; col <= headers.length; col++) {
        const cell = worksheet.getCell(rowIndex + 6, col);
        cell.font = { name: 'Tahoma', size: 10 };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      }
    });

    // Mengatur lebar kolom
    worksheet.getColumn(1).width = 10; // Lebar untuk nomor urut
    worksheet.getColumn(2).width = 30;
    worksheet.getColumn(3).width = 30;
    worksheet.getColumn(4).width = 30;

    // Simpan file Excel ke direktori sementara
    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_role${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath; // Kembalikan path file sementara
  }
}
