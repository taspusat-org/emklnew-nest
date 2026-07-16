import { Injectable } from '@nestjs/common';
import { AcosModel } from './acos.model';
import { dbMssql } from 'src/common/utils/db';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class AcosService {
  private readonly tableName = 'acos';

  async syncAcos(username: string) {
    return AcosModel.syncAcos(username);
  }
  async findAll({
    search,
    filters,
    pagination,
    sort,
    isLookUp,
  }: FindAllParams) {
    try {
      let { page, limit } = pagination ?? {};

      page = page ?? 1;
      limit = limit ?? 0;

      // Jika isLookUp true, lakukan counting data ACO
      if (isLookUp) {
        // Hitung jumlah data ACO (assumed 'aco' table)
        const acoCountResult = await dbMssql('acos') // Ganti dengan nama tabel yang relevan untuk ACO
          .count('id as total') // Menghitung total ACO
          .first();

        const acoCount = acoCountResult?.total || 0;

        // Jika jumlah ACO lebih dari 500, batasi hasil dengan limit
        if (Number(acoCount) > 500) {
          limit = limit || 10; // Set limit default jika tidak ada
        } else {
          limit = 0; // Jika ACO kurang dari 500, ambil semua data
        }
      }

      const offset = (page - 1) * limit;

      // Menyusun query
      const query = dbMssql(this.tableName).select('*');
      if (limit > 0) {
        query.limit(limit).offset(offset);
      }

      // Penerapan filter pencarian
      if (search) {
        query.where((builder) => {
          builder

            .orWhere('class', 'like', `%${search}%`)
            .orWhere('method', 'like', `%${search}%`)
            .orWhere('nama', 'like', `%${search}%`);
        });
      }

      // Penerapan filter tambahan
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value) {
            query.andWhere(key, 'like', `%${value}%`);
          }
        }
      }

      // Hitung total data
      const result = await dbMssql(this.tableName).count('id as total').first();
      const total = result?.total as number;

      // Menghitung total halaman
      const totalPages = Math.ceil(total / limit);

      // Penerapan sorting jika ada
      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }

      // Mengambil data
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
  async getDataAcosWithMethod() {
    const acos = await dbMssql('acos').select('*').where('method', 'GET');
    return acos;
  }
}
