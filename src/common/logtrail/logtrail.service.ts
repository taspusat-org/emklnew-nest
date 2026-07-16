import { Injectable } from '@nestjs/common';
import { CreateLogtrailDto } from './dto/create-logtrail.dto';
import { UpdateLogtrailDto } from './dto/update-logtrail.dto';
import { dbMssql } from 'src/common/utils/db';
import { uuidV7 } from 'src/utils/utils.service';
import { Knex } from 'knex';
import { FindAllParams } from '../interfaces/all.interface';
@Injectable()
export class LogtrailService {
  private readonly tableName = 'logtrail';
  async create(data: any, trx: Knex.Transaction) {
    const {
      namatabel,
      postingdari,
      idtrans,
      nobuktitrans,
      aksi,
      datajson,
      modifiedby,
    } = data;

    const insertedData = await trx(this.tableName)
      .insert({
        id: await uuidV7(trx),
        namatabel,
        postingdari,
        idtrans,
        nobuktitrans,
        aksi,
        datajson: datajson,
        modifiedby,
      })
      .returning('*');

    return insertedData;
  }

  async findAll({ search, filters, pagination, sort }: FindAllParams) {
    try {
      let { page, limit } = pagination ?? {};

      page = page ?? 1;
      limit = limit ?? 0;

      const offset = (page - 1) * limit;

      const query = dbMssql(this.tableName).select(
        'id',
        'namatabel',
        'postingdari',
        'idtrans',
        'nobuktitrans',
        'aksi',
        'modifiedby',
        dbMssql.raw("TO_CHAR(created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at"),
        dbMssql.raw("TO_CHAR(updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at"),
      );

      if (limit > 0) {
        query.limit(limit).offset(offset);
      }

      if (search) {
        query.where((builder) => {
          builder

            .orWhere('namatabel', 'like', `%${search}%`)
            .orWhere('postingdari', 'like', `%${search}%`)
            .orWhere('idtrans', 'like', `%${search}%`)
            .orWhere('nobuktitrans', 'like', `%${search}%`)
            .orWhere('aksi', 'like', `%${search}%`);
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw("TO_CHAR(??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${value}%`,
              ]);
            } else {
              query.andWhere(`${key}`, 'like', `%${value}%`);
            }
          }
        }
      }

      const result = await dbMssql(this.tableName).count('id as total').first();
      const total = result?.total as number;

      const totalPages = Math.ceil(total / limit);
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
  async processHeader(
    id: number,
    page: number = 1,
    pageSize: number = 10,
    sortKey: string = 'id',
    sortOrder: 'asc' | 'desc' = 'asc',
  ) {
    const data = await dbMssql('logtrail')
      .select('datajson', 'namatabel')
      .where({ id })
      .first();

    let result = {};
    let rows: any[] = [];
    let namatabel = '';

    // Jika data ditemukan
    if (data) {
      result = JSON.parse(data.datajson);
      namatabel = data.namatabel;

      if (Array.isArray(result)) {
        rows = result;
      } else {
        rows = [result];
      }
    }

    // Melakukan pengurutan data berdasarkan sortKey dan sortOrder
    // eslint-disable-next-line no-prototype-builtins
    if (sortKey && rows.length > 0 && rows[0].hasOwnProperty(sortKey)) {
      rows.sort((a, b) => {
        const aValue = a[sortKey];
        const bValue = b[sortKey];
        if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
    }

    // Menghitung total data dan memulai pagination
    const totalRows = rows.length;
    const startIndex = (page - 1) * pageSize;
    const pagedRows = rows.slice(startIndex, startIndex + pageSize);

    return {
      status: true,
      type: 'json',
      data: pagedRows,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalRows / pageSize),
        totalRows,
        pageSize,
      },
    };
  }

  // Fungsi untuk memproses detail
  async processDetail(
    id: number,
    page: number = 1,
    pageSize: number = 10,
    sortKey: string = 'id',
    sortOrder: 'asc' | 'desc' = 'asc',
  ) {
    const data = await dbMssql('logtrail')
      .select('datajson', 'namatabel')
      .where('idtrans', id)
      .first();

    let result = {};
    let rows: any[] = [];
    let namatabel = '';

    // Jika data ditemukan
    if (data) {
      result = JSON.parse(data.datajson);
      namatabel = data.namatabel;

      if (Array.isArray(result)) {
        rows = result;
      } else {
        rows = [result];
      }
    }

    // Melakukan pengurutan data berdasarkan sortKey dan sortOrder
    // eslint-disable-next-line no-prototype-builtins
    if (sortKey && rows.length > 0 && rows[0].hasOwnProperty(sortKey)) {
      rows.sort((a, b) => {
        const aValue = a[sortKey];
        const bValue = b[sortKey];
        if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
    }

    // Menghitung total data dan memulai pagination
    const totalRows = rows.length;
    const startIndex = (page - 1) * pageSize;
    const pagedRows = rows.slice(startIndex, startIndex + pageSize);

    return {
      status: true,
      type: 'json',
      data: pagedRows,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalRows / pageSize),
        totalRows,
        pageSize,
      },
    };
  }
}
