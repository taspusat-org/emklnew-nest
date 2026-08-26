import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { CreateLogtrailDto } from './dto/create-logtrail.dto';
import { UpdateLogtrailDto } from './dto/update-logtrail.dto';
import { dbMssql } from 'src/common/utils/db';
import { uuidV7 } from 'src/utils/utils.service';
import knex, { Knex } from 'knex';
import { FindAllParams } from '../interfaces/all.interface';
@Injectable()
export class LogtrailService {
  private readonly tableName = 'logtrail';
  private readonly viewName = 'vlogtrail';
  private readonly logger = new Logger(LogtrailService.name);

  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    const excludeSearchKeys: string[] = [
      'tglDari',
      'tglSampai',
      'statusaktif',
      'text',
    ];

    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );
    const dateFields = ['created_at', 'updated_at'];

    if (search && filters && Object.keys(filters).length > 0) {
      const sanitizedValue = String(search).trim();
      qb.where((query) => {
        searchFields.forEach((field) => {
          if (['created_at', 'updated_at'].includes(field)) {
            qb.orWhereRaw("to_char(vl.??, 'DD-MM-YYYY HH24:MI:SS') ilike ?", [
              field,
              `%${sanitizedValue}%`,
            ]);
          } else {
            query.orWhereRaw('vl.??::text ilike ?', [
              field,
              `%${sanitizedValue}%`,
            ]);
          }
        });
      });
    }

    Object.entries(filters || {}).forEach(([key, rawValue]) => {
      if (excludeSearchKeys.includes(key)) return;
      if (rawValue === null || rawValue === undefined || rawValue === '')
        return;

      const sanitizedValue = String(rawValue);
      if (dateFields.includes(key)) {
        qb.andWhereRaw("to_char(vl.??, 'DD-MM-YYYY HH24:MI:SS') ilike ?", [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else {
        qb.andWhereRaw('vl.??::text ilike ?', [key, `%${sanitizedValue}%`]);
      }
    });
  }

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

  async findAll(
    {
      search,
      filters,
      pagination,
      sort,
      isLookUp,
      useCustomOffset,
    }: FindAllParams,
    trx: Knex.Transaction,
  ) {
    try {
      const { page = 1, limit = 0, customOffset } = pagination ?? {};

      const sortBy = sort?.sortBy || 'nama';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'asc' ? 'asc' : 'desc';
      const safeFilters = filters || {};

      const countResult = await trx(`${this.tableName} as vl`)
        .count('vl.id as total')
        .modify((qb) => this.applyFilters(qb, safeFilters, search))
        .first();
      const total = Number(countResult?.total ?? 0);

      if (isLookUp && total > 500) {
        return {
          data: [],
          type: 'json',
          total,
          pagination: {
            currentPage: 1,
            totalPages: 0,
            totalItems: total,
            itemsPerPage: 0,
          },
        };
      }

      // SELECT disesuaikan DENGAN SCHEMA ASURANSI yang sebenarnya
      const query = trx(`${this.viewName} as vl`).select([
        'vl.id',
        'vl.namatabel',
        'vl.postingdari',
        'vl.idtrans',
        'vl.nobuktitrans',
        'vl.aksi',
        'vl.modifiedby',
        trx.raw(
          "to_char(vl.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
        ),
        trx.raw(
          "to_char(vl.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
        ),
      ]);

      query.modify((qb) => this.applyFilters(qb, safeFilters, search));

      if (sortBy === 'statusaktif') {
        query.orderBy('vl.text', sortDirection);
      } else {
        query.orderBy(`vl.${sortBy}`, sortDirection);
      }

      const offset =
        useCustomOffset === true && customOffset !== undefined
          ? customOffset
          : (page - 1) * limit;

      if (limit > 0) {
        query.offset(offset).limit(limit);
      }

      const data = await query;
      const totalPages = Math.ceil(total / limit);
      const responseType = total > 500 ? 'json' : 'local';

      return {
        data,
        type: responseType,
        total,
        pagination: {
          currentPage: Number(page),
          totalPages,
          totalItems: total,
          itemsPerPage: limit,
        },
      };
    } catch (error) {
      this.logger.error('Error fetching logtrail data', error?.stack);
      throw new InternalServerErrorException('Failed to fetch logtrail data');
    }
  }
  async processHeader(
    id: number,
    page: number = 1,
    pageSize: number = 10,
    sortKey: string = 'id',
    sortOrder: 'asc' | 'desc' = 'asc',
    trx: Knex.Transaction,
  ) {
    const data = await trx(`${this.viewName} as vl`)
      .select(['vl.datajson', 'vl.namatabel'])
      .where('vl.id', id)
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
    trx: Knex.Transaction,
  ) {
    const data = await trx(`${this.viewName} as vl`)
      .select(['datajson', 'namatabel'])
      .where('vl.idtrans', id)
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
