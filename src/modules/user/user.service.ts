import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { uuidV7, withUuidV7, UtilsService } from 'src/utils/utils.service';
import { RedisService } from 'src/common/redis/redis.service';
import { dbMssql } from 'src/common/utils/db';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { Workbook } from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { Knex } from 'nestjs-knex';
@Injectable()
export class UserService {
  private readonly tableName = 'users';
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    @Inject('KNEX_CONNECTION') private readonly knex: Knex,
  ) {}
  async create(data: any, trx: any) {
    try {
      // Set password otomatis menjadi '123456'
      const passwordPlain = '12345678';
      const passwordHash = await bcrypt.hash(passwordPlain, 10); // Enkripsi password

      // Ambil hanya field yang diperlukan untuk insert
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        namakaryawan,
        page,
        limit,
        userId,
        ...insertData
      } = data;
      Object.keys(insertData).forEach((key) => {
        if (typeof insertData[key] === 'string') {
          insertData[key] = insertData[key].toUpperCase();
        }
      });
      insertData.password = passwordHash;

      // Tambahkan field password yang sudah dienkripsi ke insertData

      // Lakukan insert data ke dalam database
      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

      const newItem = insertedItems[0];
      if (data.userId) {
        const userAccess = await this.utilsService.fetchUserRolesAndUserAcl(
          data.userId,
          trx,
        );

        // Update user ACL first
        const abilityIds = userAccess.abilities.map((ability) => ability.id);
        const existingUserAclRecords = await trx('useracl')
          .where('user_id', newItem.id)
          .whereIn('aco_id', abilityIds)
          .select('aco_id');
        const existingAcoIds = new Set(
          existingUserAclRecords.map((record) => record.aco_id),
        );
        const newUserAclData = userAccess.abilities
          .filter((ability) => !existingAcoIds.has(ability.id))
          .map((ability) => ({
            user_id: newItem.id,
            aco_id: ability.id,
            modifiedby: data.modifiedby,
            created_at: dbMssql.fn.now(),
            updated_at: dbMssql.fn.now(),
          }));

        if (newUserAclData.length > 0) {
          await trx('useracl').insert(await withUuidV7(trx, newUserAclData));
        }

        // Update user roles before updating the user data
        for (const roleId of userAccess.roles) {
          const existingRole = await trx('userrole')
            .where('user_id', newItem.id)
            .andWhere('role_id', roleId)
            .first();

          if (existingRole) {
            await trx('userrole')
              .where('user_id', newItem.id)
              .andWhere('role_id', roleId)
              .update({
                modifiedby: data.modifiedby,
                updated_at: dbMssql.fn.now(),
              });
          } else {
            await trx('userrole').insert({
              id: await uuidV7(trx),
              user_id: newItem.id,
              role_id: roleId,
              modifiedby: data.modifiedby,
              created_at: dbMssql.fn.now(),
              updated_at: dbMssql.fn.now(),
            });
          }
        }

        // After roles and ACL are updated, fetch abilities and update menu
        const { abilities } =
          await this.utilsService.fetchUserRolesAndAbilities(newItem.id, trx);
        // Update menu after roles and ACL updates
        const menuData = await this.utilsService.getDataMenuSidebar(trx);
        const menuString = this.utilsService.buildMenuString(
          menuData,
          abilities,
        );
        data.menu = menuString;
        await trx(this.tableName)
          .where('id', newItem.id)
          .update({ menu: data.menu });
      }
      const itemsPerPage = data.limit || 30;
      // Siapkan query dasar
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.username',
          'u.name',
          'u.email',
          'u.statusaktif',
          'u.modifiedby',
          'k.namakaryawan',
          'u.karyawan_id',
          dbMssql.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at",
          ),
          dbMssql.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at",
          ),
          'p.memo',
          'p.text',
        ])
        .leftJoin('karyawan as k', 'u.karyawan_id', 'k.id')
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

            .orWhere('u.username', 'like', `%${search}%`)
            .orWhere('u.name', 'like', `%${search}%`)
            .orWhere('u.email', 'like', `%${search}%`)

            .orWhere('p.memo', 'like', `%${search}%`)
            .orWhere('p.text', 'like', `%${search}%`);
        });
      }

      // Ambil hasil query yang terfilter
      const filteredItems = await query;
      // Cari index item baru di hasil yang sudah difilter
      let itemIndex = filteredItems.findIndex((item) => item.id === newItem.id);

      if (itemIndex === -1) {
        itemIndex = 0;
      }

      const pageNumber = Math.floor(itemIndex / itemsPerPage) + 1;
      const endIndex = pageNumber * itemsPerPage;

      // Ambil data hingga halaman yang mencakup item baru
      const limitedItems = filteredItems.slice(0, endIndex);

      // Simpan ke Redis
      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      // Simpan log trail
      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD USER',
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
  async update(id: string, data: any, trx: any) {
    try {
      // Ambil data user ACL dan role sebelum mengambil abilities dan update menu
      if (data.userId) {
        const userAccess = await this.utilsService.fetchUserRolesAndUserAcl(
          data.userId,
          trx,
        );

        // Update user ACL first
        const abilityIds = userAccess.abilities.map((ability) => ability.id);
        const existingUserAclRecords = await trx('useracl')
          .where('user_id', id)
          .whereIn('aco_id', abilityIds)
          .select('aco_id');
        const existingAcoIds = new Set(
          existingUserAclRecords.map((record) => record.aco_id),
        );
        const newUserAclData = userAccess.abilities
          .filter((ability) => !existingAcoIds.has(ability.id))
          .map((ability) => ({
            user_id: id,
            aco_id: ability.id,
            modifiedby: data.modifiedby,
            created_at: dbMssql.fn.now(),
            updated_at: dbMssql.fn.now(),
          }));

        if (newUserAclData.length > 0) {
          await trx('useracl').insert(await withUuidV7(trx, newUserAclData));
        }

        // Update user roles before updating the user data
        for (const roleId of userAccess.roles) {
          const existingRole = await trx('userrole')
            .where('user_id', id)
            .andWhere('role_id', roleId)
            .first();

          if (existingRole) {
            await trx('userrole')
              .where('user_id', id)
              .andWhere('role_id', roleId)
              .update({
                modifiedby: data.modifiedby,
                updated_at: dbMssql.fn.now(),
              });
          } else {
            await trx('userrole').insert({
              id: await uuidV7(trx),
              user_id: id,
              role_id: roleId,
              modifiedby: data.modifiedby,
              created_at: dbMssql.fn.now(),
              updated_at: dbMssql.fn.now(),
            });
          }
        }

        // After roles and ACL are updated, fetch abilities and update menu
        const { abilities } =
          await this.utilsService.fetchUserRolesAndAbilities(id, trx);

        // Update menu after roles and ACL updates
        const menuData = await this.utilsService.getDataMenuSidebar(trx);
        const menuString = this.utilsService.buildMenuString(
          menuData,
          abilities,
        );
        data.menu = menuString;
      }

      // Ambil data yang akan diubah (kecuali userId dan data lainnya yang tidak ingin diubah)
      const {
        sortBy,
        sortDirection,
        filters,
        search,
        page,
        limit,
        statusaktif_text,
        userId,
        namakaryawan,
        ...updateData
      } = data;

      const existingData = await trx(this.tableName).where('id', id).first();
      if (!existingData) {
        throw new Error('Data not found');
      }
      const hasChanges = this.utilsService.hasChanges(updateData, existingData);

      if (hasChanges) {
        // Melakukan update data yang sudah dipisahkan
        await trx(this.tableName).where('id', id).update(updateData);
      }

      // Ambil semua item dengan filter ID yang lebih kecil atau sama dengan yang diupdate
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.username',
          'u.name',
          'u.email',
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
        .orderBy(sortBy ? `u.${sortBy}` : 'u.id', sortDirection || 'desc');

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

            .orWhere('u.username', 'like', `%${search}%`)
            .orWhere('u.name', 'like', `%${search}%`)
            .orWhere('u.email', 'like', `%${search}%`)

            .orWhere('p.memo', 'like', `%${search}%`)
            .orWhere('p.text', 'like', `%${search}%`);
        });
      }

      // Ambil hasil query yang terfilter
      const allItems = await query;
      const itemIndex = allItems.findIndex((item) => Number(item.id) === id);
      if (itemIndex === -1) {
        throw new Error('Updated item not found in all items');
      }

      const pageNumber = Math.floor(itemIndex / limit) + 1;

      // Ambil data hingga halaman yang mencakup item yang baru diperbarui
      const endIndex = pageNumber * limit;
      const limitedItems = allItems.slice(0, endIndex);

      // Simpan ke Redis
      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      // Simpan log trail
      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT USER',
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
          ...updateData,
        },
        pageNumber,
        itemIndex,
      };
    } catch (error) {
      console.error('Error updating menu:', error);
      throw new Error('Failed to update menu');
    }
  }

  async findAll({ search, filters, pagination, sort }: FindAllParams) {
    try {
      let { page, limit } = pagination ?? {};

      page = page ?? 1;
      limit = limit ?? 0;
      const offset = (page - 1) * limit;

      const query = dbMssql(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.username',
          'u.name',
          'u.email',
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

      if (limit > 0) {
        query.limit(limit).offset(offset);
      }

      if (search) {
        const esc = search.replace(/\[/g, '[[]');
        // Penggunaan parameterized query untuk pencarian
        query.where((builder) => {
          builder

            .orWhere('u.username', 'like', `%${esc}%`)
            .orWhere('u.name', 'like', `%${esc}%`)
            .orWhere('u.email', 'like', `%${esc}%`);
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value) {
            // Escape karakter [ dan ] dalam filters
            const sanitizedValue = String(value).replace(/\[/g, '[[]');

            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else if (key === 'text') {
              query.andWhere(`p.${key}`, 'like', `%${sanitizedValue}%`);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }
      const result = await dbMssql(this.tableName).count('id as total').first();
      const total = result?.total as number;

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
      const tempData = `##temp_${Math.random().toString(36).substring(2, 15)}`;

      // Membuat temporary table
      const createTempTableQuery = `
        CREATE TABLE ${tempData} (
          id NVARCHAR(100)
        );
      `;
      await dbMssql.raw(createTempTableQuery);

      // Memasukkan data ID ke dalam temporary table
      const insertTempTableQuery = `
        INSERT INTO ${tempData} (id)
        VALUES ${idList.map((id) => `('${id}')`).join(', ')};
      `;
      await dbMssql.raw(insertTempTableQuery);

      // Query utama dengan JOIN ke temporary table
      const query = dbMssql(`${this.tableName} as u`)
        .select([
          'u.id as id',
          'u.username',
          'u.name',
          'u.email',
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
        .join(dbMssql.raw(`${tempData} as temp`), 'u.id', 'temp.id') // Menggunakan JOIN antar tabel user dan temporary table
        .orderBy('u.username', 'ASC');

      const data = await query;

      // Menghapus temporary table setelah query selesai
      const dropTempTableQuery = `DROP TABLE ${tempData};`;
      await dbMssql.raw(dropTempTableQuery);

      return data;
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
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
  async createTemporaryTable() {
    try {
      const tempPenjualanDetail = `##temp_${Math.random().toString(36).substring(2, 15)}`;

      const exists = await this.knex.schema.hasTable(tempPenjualanDetail);

      if (!exists) {
        await this.knex.schema.createTable(tempPenjualanDetail, (table) => {
          table.bigIncrements('id').primary();
          table.string('username', 255).nullable();
          table.string('name', 255).nullable();
          table.string('password', 255).nullable();
          table.string('email', 255).nullable();
          table.text('menu').nullable();
          table.bigInteger('statusaktif').nullable();
          table.string('modifiedby', 255).nullable();
        });

        const data = [
          {
            username: 'johndoe',
            name: 'John Doe',
            password: 'password123',
            email: 'johndoe@example.com',
            menu: 'Dashboard, Settings',
            statusaktif: 1,
            modifiedby: 'admin',
          },
          {
            username: 'janedoe',
            name: 'Jane Doe',
            password: 'password456',
            email: 'janedoe@example.com',
            menu: 'Dashboard, Profile',
            statusaktif: 1,
            modifiedby: 'admin',
          },
        ];

        await this.knex(tempPenjualanDetail).insert(data);
      }

      const result = await this.knex(tempPenjualanDetail).select('*');

      return {
        message:
          'Temporary user table already created. Data retrieved successfully.',
        data: result,
      };
    } catch (error) {
      console.error(
        'Error creating temporary table and inserting data:',
        error,
      );
      throw new InternalServerErrorException(
        'Failed to create temporary table and insert data',
      );
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} user`;
  }

  async selectFromTemporaryTable() {
    try {
      const parameters = await dbMssql('parameter').select([
        'id',
        'memo',
        'text',
      ]);

      await dbMssql.raw(`
        CREATE TABLE ##TempUserParameter (
          user_id INT,
          username VARCHAR(255),
          name VARCHAR(255),
          email VARCHAR(255),
          statusaktif INT,
          memo VARCHAR(255),
          text VARCHAR(255)
        );
      `);

      await dbMssql.raw(`
        CREATE TABLE ##TempParameter (
          id INT,
          memo VARCHAR(255),
          text VARCHAR(255)
        );
      `);

      for (const param of parameters) {
        await dbMssql('##TempParameter').insert({
          id: param.id,
          memo: param.memo,
          text: param.text,
        });
      }

      await dbMssql.raw(`
        INSERT INTO ##TempUserParameter (user_id, username, name, email, statusaktif, memo, text)
        SELECT 
          u.id AS user_id,
          u.username,
          u.name,
          u.email,
          u.statusaktif,
          p.memo,
          p.text
        FROM 
          ${this.tableName} AS u
        LEFT JOIN 
          ##TempParameter AS p ON u.statusaktif = p.id;
      `);

      const result = await dbMssql.raw('SELECT * FROM ##TempUserParameter');

      await dbMssql.raw('DROP TABLE ##TempUserParameter');
      await dbMssql.raw('DROP TABLE ##TempParameter');

      return result;
    } catch (error) {
      console.error('Error with temporary table operation:', error);
      throw new InternalServerErrorException(
        'Failed to perform operation on temporary table',
      );
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
          postingdari: 'DELETE USER',
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
    worksheet.getCell('A2').value = 'LAPORAN USER';
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
    const headers = [
      'No.',
      'Username',
      'Name',
      'Email',
      'Status Aktif',
      'Created At',
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

    // Mengisi data ke dalam Excel dengan nomor urut sebagai ID
    data.forEach((row, rowIndex) => {
      worksheet.getCell(rowIndex + 6, 1).value = rowIndex + 1; // Nomor urut (ID)
      worksheet.getCell(rowIndex + 6, 2).value = row.username;
      worksheet.getCell(rowIndex + 6, 3).value = row.name;
      worksheet.getCell(rowIndex + 6, 4).value = row.email;
      worksheet.getCell(rowIndex + 6, 5).value = row.text;
      worksheet.getCell(rowIndex + 6, 6).value = row.created_at;

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
      const progress = Math.round(((rowIndex + 1) / data.length) * 100);
    });

    // Mengatur lebar kolom
    worksheet.getColumn(1).width = 10; // Lebar untuk nomor urut
    worksheet.getColumn(2).width = 30;
    worksheet.getColumn(3).width = 30;
    worksheet.getColumn(4).width = 30;
    worksheet.getColumn(5).width = 15;
    worksheet.getColumn(6).width = 20;
    worksheet.getColumn('F').numFmt = 'dd-mm-yyyy hh:mm:ss';

    // Simpan file Excel ke direktori sementara
    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_user${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath; // Kembalikan path file sementara
  }
}
