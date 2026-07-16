import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { RedisService } from 'src/common/redis/redis.service';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import {
  dbMssql,
  dbMdnEmkl,
  dbbtgEmkl,
  dbMdnTruck,
  dbmksEmkl,
} from 'src/common/utils/db';
import * as fs from 'fs';
import * as path from 'path';
import { Workbook } from 'exceljs';
@Injectable()
export class OffdaysService {
  private readonly tableName = 'harilibur';
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
      const formatDate = (date: string) => {
        const [day, month, year] = date.split('-'); // Misalnya '23-05-2025' -> ['23', '05', '2025']
        return `${year}-${month}-${day}`; // Menghasilkan '2025-05-23'
      };
      if (insertData.tgl) {
        insertData.tgl = formatDate(insertData.tgl); // Format tgl menjadi yyyy-MM-dd
      }

      insertData.updated_at = this.utilsService.getTime();
      insertData.created_at = this.utilsService.getTime();

      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');

      const newItem = insertedItems[0];
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          trx.raw("TO_CHAR(u.tgl, 'DD-MM-YYYY') AS tgl"),
          'u.keterangan',
          'u.statusaktif',
          'u.modifiedby',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at"),
          'p.memo',
          'p.text',
        ])
        .leftJoin('parameter as p', 'u.statusaktif', 'p.id')
        .orderBy(sortBy ? `u.${sortBy}` : 'u.id', sortDirection || 'desc')
        .where('u.id', '<=', newItem.id);
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
      if (search) {
        query.where((builder) => {
          builder

            .orWhere('u.tgl', 'like', `%${search}%`)
            .orWhere('u.keterangan', 'like', `%${search}%`)
            .orWhere('u.email', 'like', `%${search}%`)

            .orWhere('p.memo', 'like', `%${search}%`)
            .orWhere('p.text', 'like', `%${search}%`);
        });
      }
      const filteredItems = await query;
      // Cari index item baru di hasil yang sudah difilter
      const itemIndex = filteredItems.findIndex(
        (item) => item.id === newItem.id,
      );
      const pageNumber = Math.floor(itemIndex / limit) + 1;
      const endIndex = pageNumber * limit;
      const limitedItems = filteredItems.slice(0, endIndex);

      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );
      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD OFFDAYS',
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

  async findAllTes() {
    const response = await dbbtgEmkl('fuserlist').select('*');

    return response;
  }
  async findAll(
    { search, filters, pagination, sort }: FindAllParams,
    trx: any,
  ) {
    try {
      console.log(filters, 'filters');
      console.log(pagination, 'pagination');
      console.log(sort, 'sort');
      console.log(search, 'search');
      let { page, limit } = pagination ?? {};

      page = page ?? 1;
      limit = limit ?? 0;

      const offset = (page - 1) * limit;
      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          trx.raw("TO_CHAR(u.tgl, 'DD-MM-YYYY') AS tgl"),
          'u.keterangan',
          'u.statusaktif',
          'u.modifiedby',
          'u.cabang_id',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at"),
          'p.memo',
          'p.text',
        ])
        .leftJoin('parameter as p', 'u.statusaktif', 'p.id');
      if (limit > 0) {
        query.limit(limit).offset(offset);
      }

      // if (search) {
      //   query.where((builder) => {
      //     builder

      //       .orWhere('u.tgl', 'like', `%${search}%`)
      //       .orWhere('u.keterangan', 'like', `%${search}%`)
      //       .orWhere('u.email', 'like', `%${search}%`)

      //       .orWhere('p.memo', 'like', `%${search}%`)
      //       .orWhere('p.text', 'like', `%${search}%`);
      //   });
      // }

      // if (filters) {
      //   for (const [key, value] of Object.entries(filters)) {
      //     if (value) {
      //       if (key === 'tgl') {
      //         query.andWhereRaw('u.tgl LIKE ?', [`%${value}%`]); // Sort by the actual date
      //       } else if (key === 'cabang_id') {
      //         query.andWhereRaw('u.cabang_id = ?', [value]);
      //       } else if (key === 'created_at' || key === 'updated_at') {
      //         query.andWhereRaw(
      //           `TO_CHAR(${key}, 'DD-MM-YYYY HH24:MI:SS') LIKE ?`,
      //           [`%${value}%`],
      //         );
      //       } else {
      //         query.andWhere(key, 'like', `%${value}%`);
      //       }
      //     }
      //   }
      // }
      // if (sort?.sortBy && sort?.sortDirection) {
      //   // Sorting based on the actual column (not the formatted string)
      //   if (sort.sortBy === 'tgl' || sort.sortBy === 'cabang_id') {
      //     query.orderBy('u.tgl', sort.sortDirection); // Sort by actual 'tgl' column
      //   } else {
      //     query.orderBy(sort.sortBy, sort.sortDirection);
      //   }
      // }

      const result = await trx(this.tableName).count('id as total').first();
      const total = result?.total as number;

      const totalPages = Math.ceil(total / limit);

      const data = await query;
      console.log(data, 'data');
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
      console.log(error, 'error');
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }
  async findAllTrado({ search, filters, pagination, sort }: FindAllParams) {
    try {
      let { page, limit } = pagination ?? {};

      page = page ?? 1;
      limit = limit ?? 0;

      const offset = (page - 1) * limit;
      const query = dbMssql('trado as u')
        .select([
          'u.id as id',
          'u.keterangan',
          'u.kodetrado',
          'u.kmawal',
          'u.kmakhirgantioli',
          'u.merek',
          'u.norangka',
          'u.nomesin',
          'u.nama',
          'u.nostnk',
          'u.alamatstnk',
          'u.modifiedby',
          dbMssql.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at",
          ),
          dbMssql.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at",
          ),
          // dbMssql.raw(
          //   "CASE WHEN YEAR(COALESCE(u.tglserviceopname, '1900-01-01')) = 1900 THEN NULL ELSE u.tglserviceopname END AS tglserviceopname",
          // ),
          // 'u.keteranganprogressstandarisasi',
          // dbMssql.raw(
          //   "CASE WHEN YEAR(COALESCE(u.tglgantiakiterakhir, '1900-01-01')) = 1900 THEN NULL ELSE u.tglgantiakiterakhir END AS tglgantiakiterakhir",
          // ),
          'u.tipe',
          'u.jenis',
          'u.isisilinder',
          'u.warna',
          'u.jenisbahanbakar',
          'u.jumlahsumbu',
          'u.jumlahroda',
          'u.model',
          'u.tahun',
          // dbMssql.raw(
          //   'IFNULL(u.nominalplusborongan, 0) AS nominalplusborongan',
          // ),
          'u.nobpkb',
          'u.jumlahbanserap',
          'u.photostnk',
          'u.photobpkb',
          'u.phototrado',
          'parameter_statusaktif.memo AS statusaktif',
          'parameter_statusstandarisasi.memo AS statusstandarisasi',
          'parameter_statusjenisplat.memo AS statusjenisplat',
          'parameter_statusmutasi.memo AS statusmutasi',
          'parameter_statusvalidasikendaraan.memo AS statusvalidasikendaraan',
          'parameter_statusmobilstoring.memo AS statusmobilstoring',
          'parameter_statusappeditban.memo AS statusappeditban',
          'parameter_statuslewatvalidasi.memo AS statuslewatvalidasi',
          'parameter_statusabsensisupir.memo AS statusabsensisupir',
          'mandor.namamandor AS mandor_id',
          'supir.id AS supirid',
          'supir.namasupir AS supir_id',
          'u.updated_at',
          // dbMssql.raw(
          //   "IFNULL(parameter_statusapprovalhistorymilikmandor.memo, 'Non-DISETUJUI') AS statusapprovalhistorytradomilikmandor",
          // ),
          'u.userapprovalhistorytradomilikmandor AS userapprovalhistorytradomilikmandor',
          'u.tglapprovalhistorytradomilikmandor AS tglapprovalhistorytradomilikmandor',
          'u.tglupdatehistorytradomilikmandor AS tglupdatehistorytradomilikmandor',
          // dbMssql.raw(
          //   "IFNULL(parameter_statusapprovalhistorymiliksupir.memo, 'Non-DISETUJUI') AS statusapprovalhistorytradomiliksupir",
          // ),
          'u.userapprovalhistorytradomiliksupir AS userapprovalhistorytradomiliksupir',
          'u.tglapprovalhistorytradomiliksupir AS tglapprovalhistorytradomiliksupir',
          'u.tglupdatehistorytradomiliksupir AS tglupdatehistorytradomiliksupir',
          'u.tglberlakumilikmandor',
          'u.tglberlakumiliksupir',
        ])
        .leftJoin(
          'parameter as parameter_statusaktif',
          'u.statusaktif',
          'parameter_statusaktif.id',
        )
        .leftJoin(
          'parameter as parameter_statusjenisplat',
          'u.statusjenisplat',
          'parameter_statusjenisplat.id',
        )
        .leftJoin(
          'parameter as parameter_statusstandarisasi',
          'u.statusstandarisasi',
          'parameter_statusstandarisasi.id',
        )
        .leftJoin(
          'parameter as parameter_statusmutasi',
          'u.statusmutasi',
          'parameter_statusmutasi.id',
        )
        .leftJoin(
          'parameter as parameter_statusvalidasikendaraan',
          'u.statusvalidasikendaraan',
          'parameter_statusvalidasikendaraan.id',
        )
        .leftJoin(
          'parameter as parameter_statusmobilstoring',
          'u.statusmobilstoring',
          'parameter_statusmobilstoring.id',
        )
        .leftJoin(
          'parameter as parameter_statusappeditban',
          'u.statusappeditban',
          'parameter_statusappeditban.id',
        )
        .leftJoin(
          'parameter as parameter_statuslewatvalidasi',
          'u.statuslewatvalidasi',
          'parameter_statuslewatvalidasi.id',
        )
        .leftJoin(
          'parameter as parameter_statusabsensisupir',
          'u.statusabsensisupir',
          'parameter_statusabsensisupir.id',
        )
        .leftJoin(
          'parameter as parameter_statusapprovalhistorymilikmandor',
          'u.statusapprovalhistorytradomilikmandor',
          'parameter_statusapprovalhistorymilikmandor.id',
        )
        .leftJoin(
          'parameter as parameter_statusapprovalhistorymiliksupir',
          'u.statusapprovalhistorytradomiliksupir',
          'parameter_statusapprovalhistorymiliksupir.id',
        )
        .leftJoin('mandor', 'u.mandor_id', 'mandor.id')
        .leftJoin('supir', 'u.supir_id', 'supir.id');

      // Handle search functionality
      if (search) {
        query.where((builder) => {
          builder
            .orWhere('u.keterangan', 'like', `%${search}%`)
            .orWhere('u.kodetrado', 'like', `%${search}%`)
            .orWhere('u.norangka', 'like', `%${search}%`)
            .orWhere('u.nomesin', 'like', `%${search}%`);
        });
      }

      // Handle filters
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value) {
            query.andWhere(key, 'like', `%${value}%`);
          }
        }
      }

      // Pagination
      if (limit > 0) {
        query.limit(limit).offset(offset);
      }

      // Sorting
      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }
      const querys = query.toQuery();
      const result = await dbMssql(this.tableName).count('id as total').first();
      const total = result?.total as number;
      const totalPages = Math.ceil(total / limit);

      const data = await query;

      return {
        data,
        total,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems: total,
          itemsPerPage: limit,
        },
      };
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }
  async findAllTradoInnerJoin({
    search,
    filters,
    pagination,
    sort,
  }: FindAllParams) {
    try {
      let { page, limit } = pagination ?? {};

      page = page ?? 1;
      limit = limit ?? 0;

      const offset = (page - 1) * limit;
      const query = dbMssql('trado as u')
        .select([
          'u.id as id',
          'u.keterangan',
          'u.kodetrado',
          'u.kmawal',
          'u.kmakhirgantioli',
          'u.merek',
          'u.norangka',
          'u.nomesin',
          'u.nama',
          'u.nostnk',
          'u.alamatstnk',
          'u.modifiedby',
          dbMssql.raw(
            "TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at",
          ),
          dbMssql.raw(
            "TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at",
          ),
          // dbMssql.raw(
          //   "CASE WHEN YEAR(COALESCE(u.tglserviceopname, '1900-01-01')) = 1900 THEN NULL ELSE u.tglserviceopname END AS tglserviceopname",
          // ),
          // 'u.keteranganprogressstandarisasi',
          // dbMssql.raw(
          //   "CASE WHEN YEAR(COALESCE(u.tglgantiakiterakhir, '1900-01-01')) = 1900 THEN NULL ELSE u.tglgantiakiterakhir END AS tglgantiakiterakhir",
          // ),
          'u.tipe',
          'u.jenis',
          'u.isisilinder',
          'u.warna',
          'u.jenisbahanbakar',
          'u.jumlahsumbu',
          'u.jumlahroda',
          'u.model',
          'u.tahun',
          // dbMssql.raw(
          //   'IFNULL(u.nominalplusborongan, 0) AS nominalplusborongan',
          // ),
          'u.nobpkb',
          'u.jumlahbanserap',
          'u.photostnk',
          'u.photobpkb',
          'u.phototrado',
          'parameter_statusaktif.memo AS statusaktif',
          'parameter_statusstandarisasi.memo AS statusstandarisasi',
          'parameter_statusjenisplat.memo AS statusjenisplat',
          'parameter_statusmutasi.memo AS statusmutasi',
          'parameter_statusvalidasikendaraan.memo AS statusvalidasikendaraan',
          'parameter_statusmobilstoring.memo AS statusmobilstoring',
          'parameter_statusappeditban.memo AS statusappeditban',
          'parameter_statuslewatvalidasi.memo AS statuslewatvalidasi',
          'parameter_statusabsensisupir.memo AS statusabsensisupir',
          'mandor.namamandor AS mandor_id',
          'supir.id AS supirid',
          'supir.namasupir AS supir_id',
          'u.updated_at',
          // dbMssql.raw(
          //   "IFNULL(parameter_statusapprovalhistorymilikmandor.memo, 'Non-DISETUJUI') AS statusapprovalhistorytradomilikmandor",
          // ),
          'u.userapprovalhistorytradomilikmandor AS userapprovalhistorytradomilikmandor',
          'u.tglapprovalhistorytradomilikmandor AS tglapprovalhistorytradomilikmandor',
          'u.tglupdatehistorytradomilikmandor AS tglupdatehistorytradomilikmandor',
          // dbMssql.raw(
          //   "IFNULL(parameter_statusapprovalhistorymiliksupir.memo, 'Non-DISETUJUI') AS statusapprovalhistorytradomiliksupir",
          // ),
          'u.userapprovalhistorytradomiliksupir AS userapprovalhistorytradomiliksupir',
          'u.tglapprovalhistorytradomiliksupir AS tglapprovalhistorytradomiliksupir',
          'u.tglupdatehistorytradomiliksupir AS tglupdatehistorytradomiliksupir',
          'u.tglberlakumilikmandor',
          'u.tglberlakumiliksupir',
        ])
        .innerJoin(
          'parameter as parameter_statusaktif',
          'u.statusaktif',
          'parameter_statusaktif.id',
        )
        .innerJoin(
          'parameter as parameter_statusjenisplat',
          'u.statusjenisplat',
          'parameter_statusjenisplat.id',
        )
        .innerJoin(
          'parameter as parameter_statusstandarisasi',
          'u.statusstandarisasi',
          'parameter_statusstandarisasi.id',
        )
        .innerJoin(
          'parameter as parameter_statusmutasi',
          'u.statusmutasi',
          'parameter_statusmutasi.id',
        )
        .innerJoin(
          'parameter as parameter_statusvalidasikendaraan',
          'u.statusvalidasikendaraan',
          'parameter_statusvalidasikendaraan.id',
        )
        .innerJoin(
          'parameter as parameter_statusmobilstoring',
          'u.statusmobilstoring',
          'parameter_statusmobilstoring.id',
        )
        .innerJoin(
          'parameter as parameter_statusappeditban',
          'u.statusappeditban',
          'parameter_statusappeditban.id',
        )
        .innerJoin(
          'parameter as parameter_statuslewatvalidasi',
          'u.statuslewatvalidasi',
          'parameter_statuslewatvalidasi.id',
        )
        .innerJoin(
          'parameter as parameter_statusabsensisupir',
          'u.statusabsensisupir',
          'parameter_statusabsensisupir.id',
        )
        .innerJoin(
          'parameter as parameter_statusapprovalhistorymilikmandor',
          'u.statusapprovalhistorytradomilikmandor',
          'parameter_statusapprovalhistorymilikmandor.id',
        )
        .innerJoin(
          'parameter as parameter_statusapprovalhistorymiliksupir',
          'u.statusapprovalhistorytradomiliksupir',
          'parameter_statusapprovalhistorymiliksupir.id',
        )
        .innerJoin('mandor', 'u.mandor_id', 'mandor.id')
        .innerJoin('supir', 'u.supir_id', 'supir.id');

      // Handle search functionality
      if (search) {
        query.where((builder) => {
          builder
            .orWhere('u.keterangan', 'like', `%${search}%`)
            .orWhere('u.kodetrado', 'like', `%${search}%`)
            .orWhere('u.norangka', 'like', `%${search}%`)
            .orWhere('u.nomesin', 'like', `%${search}%`);
        });
      }

      // Handle filters
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value) {
            query.andWhere(key, 'like', `%${value}%`);
          }
        }
      }

      // Pagination
      if (limit > 0) {
        query.limit(limit).offset(offset);
      }

      // Sorting
      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }
      const querys = query.toQuery();
      const result = await dbMssql(this.tableName).count('id as total').first();
      const total = result?.total as number;
      const totalPages = Math.ceil(total / limit);

      const data = await query;

      return {
        data,
        total,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems: total,
          itemsPerPage: limit,
        },
      };
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }
  async findAllTradoInnerJoin2({
    search,
    filters,
    pagination,
    sort,
  }: FindAllParams) {
    try {
      let { page, limit } = pagination ?? {};
      page = page ?? 1;
      limit = limit ?? 0;
      const offset = (page - 1) * limit;

      // Generate a random name for the temporary table
      const tempTable = `##temp_${Math.random().toString(36).substring(2, 15)}`;
      const tempParameter_statusaktif =
        '##temp_statusaktif_' + Math.random().toString(36).substring(2, 8);
      const tempParameter_statusjenisplat =
        '##temp_jenisplat_' + Math.random().toString(36).substring(2, 8);
      const tempParameter_statusstandarisasi =
        '##temp_statusstandarisasi_' +
        Math.random().toString(36).substring(2, 8);
      const tempParameter_statusmutasi =
        '##temp_statusmutasi_' + Math.random().toString(36).substring(2, 8);
      const tempParameter_statusvalidasikendaraan =
        '##temp_statusvalidasikendaraan_' +
        Math.random().toString(36).substring(2, 8);
      const tempParameter_statusmobilstoring =
        '##temp_statusmobilstoring_' +
        Math.random().toString(36).substring(2, 8);
      const tempParameter_statusappeditban =
        '##temp_statusappeditban_' + Math.random().toString(36).substring(2, 8);
      const tempParameter_statuslewatvalidasi =
        '##temp_statuslewatvalidasi_' +
        Math.random().toString(36).substring(2, 8);
      const tempParameter_statusabsensisupir =
        '##temp_statusabsensisupir_' +
        Math.random().toString(36).substring(2, 8);
      const tempParameter_statusapprovalhistorytradomilikmandor =
        '##temp_statusapprovalhistorytradomilikmandor_' +
        Math.random().toString(36).substring(2, 8);
      const tempmandor =
        '##tempmandor' + Math.random().toString(36).substring(2, 8);
      const tempsupir =
        '##temp_supir' + Math.random().toString(36).substring(2, 8);

      // Create the temporary table with all the fields from the trado table
      // Create the temporary table with the correct field types
      await dbMssql.raw(`
    CREATE TABLE ${tempTable} (
      id BIGINT,
      kodetrado NVARCHAR(255),
      keterangan NVARCHAR(255),
      statusaktif INT,
      statusgerobak INT,
      nominalplusborongan FLOAT,
      kmawal FLOAT,
      kmakhirgantioli FLOAT,
      tglakhirgantioli DATE,
      tglstnkmati DATE,
      tglasuransimati DATE,
      tahun NVARCHAR(255),
      akhirproduksi NVARCHAR(255),
      merek NVARCHAR(255),
      norangka NVARCHAR(255),
      nomesin NVARCHAR(255),
      nama NVARCHAR(255),
      nostnk NVARCHAR(255),
      alamatstnk NVARCHAR(255),
      tglstandarisasi DATE,
      tglserviceopname DATE,
      statusstandarisasi INT,
      keteranganprogressstandarisasi NVARCHAR(255),
      statusjenisplat INT,
      tglspeksimati DATE,
      tglpajakstnk DATE,
      tglgantiakiterakhir DATE,
      statusmutasi INT,
      statusvalidasikendaraan INT,
      tipe NVARCHAR(255),
      jenis NVARCHAR(255),
      isisilinder INT,
      warna NVARCHAR(255),
      jenisbahanbakar NVARCHAR(255),
      jumlahsumbu INT,
      jumlahroda INT,
      model NVARCHAR(255),
      nobpkb NVARCHAR(255),
      statusmobilstoring INT,
      mandor_id BIGINT,
      supir_id BIGINT,
      jumlahbanserap INT,
      statusappeditban INT,
      statuslewatvalidasi INT,
      photostnk NVARCHAR(255),
      photobpkb NVARCHAR(255),
      phototrado NVARCHAR(255),
      modifiedby NVARCHAR(255),
      created_at DATETIME,
      updated_at DATETIME,
      statusabsensisupir INT,
      info NVARCHAR(255),
      editing_at DATETIME,
      editing_by VARCHAR(255),
      statusapprovalhistorytradomilikmandor INT,
      statusapprovalhistorytradomiliksupir INT,
      statusapprovalreminderoligardan INT,
      statusapprovalreminderolimesin INT,
      statusapprovalreminderolipersneling INT,
      statusapprovalremindersaringanhawa INT,
      tas_id INT,
      tglapprovalhistorytradomilikmandor DATETIME,
      tglapprovalhistorytradomiliksupir DATETIME,
      tglapprovalreminderoligardan DATETIME,
      tglapprovalreminderolimesin DATETIME,
      tglapprovalreminderolipersneling DATETIME,
      tglapprovalremindersaringanhawa DATETIME,
      tglbatasreminderoligardan DATETIME,
      tglbatasreminderolimesin DATETIME,
      tglbatasreminderolipersneling DATETIME,
      tglbatasremindersaringanhawa DATETIME,
      tglberlakumilikmandor DATE,
      tglberlakumiliksupir DATE,
      tglupdatehistorytradomilikmandor DATETIME,
      tglupdatehistorytradomiliksupir DATETIME,
      userapprovalhistorytradomilikmandor VARCHAR(255),
      userapprovalhistorytradomiliksupir VARCHAR(255),
      userapprovalreminderoligardan VARCHAR(255),
      userapprovalreminderolimesin VARCHAR(255),
      userapprovalreminderolipersneling VARCHAR(255),
      userapprovalremindersaringanhawa VARCHAR(255),
      kodetradoold NVARCHAR(255),
      tglstid DATE
    );
  `);
      // Step 1: Insert a row with all NULL values
      await dbMssql.raw(`
  INSERT INTO ${tempTable}
    (id, kodetrado, keterangan, statusaktif, statusgerobak, nominalplusborongan, kmawal, kmakhirgantioli, tglakhirgantioli, tglstnkmati,
     tglasuransimati, tahun, akhirproduksi, merek, norangka, nomesin, nama, nostnk, alamatstnk, tglstandarisasi, tglserviceopname,
     statusstandarisasi, keteranganprogressstandarisasi, statusjenisplat, tglspeksimati, tglpajakstnk, tglgantiakiterakhir,
     statusmutasi, statusvalidasikendaraan, tipe, jenis, isisilinder, warna, jenisbahanbakar, jumlahsumbu, jumlahroda, model, nobpkb,
     statusmobilstoring, mandor_id, supir_id, jumlahbanserap, statusappeditban, statuslewatvalidasi, photostnk, photobpkb, phototrado,
     modifiedby, created_at, updated_at, statusabsensisupir, info, editing_at, editing_by, statusapprovalhistorytradomilikmandor,
     statusapprovalhistorytradomiliksupir, statusapprovalreminderoligardan, statusapprovalreminderolimesin,
     statusapprovalreminderolipersneling, statusapprovalremindersaringanhawa, tas_id, tglapprovalhistorytradomilikmandor,
     tglapprovalhistorytradomiliksupir, tglapprovalreminderoligardan, tglapprovalreminderolimesin, tglapprovalreminderolipersneling,
     tglapprovalremindersaringanhawa, tglbatasreminderoligardan, tglbatasreminderolimesin, tglbatasreminderolipersneling,
     tglbatasremindersaringanhawa, tglberlakumilikmandor, tglberlakumiliksupir, tglupdatehistorytradomilikmandor,
     tglupdatehistorytradomiliksupir, userapprovalhistorytradomilikmandor, userapprovalhistorytradomiliksupir,
     userapprovalreminderoligardan, userapprovalreminderolimesin, userapprovalreminderolipersneling, userapprovalremindersaringanhawa,
     kodetradoold, tglstid)
    VALUES
    (NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,NULL ,NULL, NULL);

  `);

      // Step 2: Insert the actual data from trado table
      await dbMssql.raw(`
    INSERT INTO ${tempTable}
    SELECT
      id, kodetrado, keterangan, statusaktif, statusgerobak, nominalplusborongan, kmawal, kmakhirgantioli, tglakhirgantioli, tglstnkmati,
      tglasuransimati, tahun, akhirproduksi, merek, norangka, nomesin, nama, nostnk, alamatstnk, tglstandarisasi, tglserviceopname,
      statusstandarisasi, keteranganprogressstandarisasi, statusjenisplat, tglspeksimati, tglpajakstnk, tglgantiakiterakhir, statusmutasi,
      statusvalidasikendaraan, tipe, jenis, isisilinder, warna, jenisbahanbakar, jumlahsumbu, jumlahroda, model, nobpkb, statusmobilstoring,
      mandor_id, supir_id, jumlahbanserap, statusappeditban, statuslewatvalidasi, photostnk, photobpkb, phototrado, modifiedby, created_at,
      updated_at, statusabsensisupir, info, editing_at, editing_by, statusapprovalhistorytradomilikmandor, statusapprovalhistorytradomiliksupir,
      statusapprovalreminderoligardan, statusapprovalreminderolimesin, statusapprovalreminderolipersneling,
      statusapprovalremindersaringanhawa, tas_id, tglapprovalhistorytradomilikmandor, tglapprovalhistorytradomiliksupir,
      tglapprovalreminderoligardan, tglapprovalreminderolimesin, tglapprovalreminderolipersneling, tglapprovalremindersaringanhawa,
      tglbatasreminderoligardan, tglbatasreminderolimesin, tglbatasreminderolipersneling, tglbatasremindersaringanhawa,
      tglberlakumilikmandor, tglberlakumiliksupir, tglupdatehistorytradomilikmandor, tglupdatehistorytradomiliksupir,
      userapprovalhistorytradomilikmandor, userapprovalhistorytradomiliksupir, userapprovalreminderoligardan,
      userapprovalreminderolimesin, userapprovalreminderolipersneling, userapprovalremindersaringanhawa, kodetradoold, tglstid
    FROM trado;
  `);

      await dbMssql.schema.createTable(tempParameter_statusaktif, (t) => {
        t.integer('id');
        t.string('text');
        t.index('id');
      });
      await dbMssql.schema.createTable(tempParameter_statusjenisplat, (t) => {
        t.integer('id');
        t.string('text');
        t.index('id');
      });
      await dbMssql.schema.createTable(
        tempParameter_statusstandarisasi,
        (t) => {
          t.integer('id');
          t.string('text');
          t.index('id');
        },
      );
      await dbMssql.schema.createTable(tempParameter_statusmutasi, (t) => {
        t.integer('id');
        t.string('text');
        t.index('id');
      });
      await dbMssql.schema.createTable(
        tempParameter_statusvalidasikendaraan,
        (t) => {
          t.integer('id');
          t.string('text');
          t.index('id');
        },
      );
      await dbMssql.schema.createTable(
        tempParameter_statusmobilstoring,
        (t) => {
          t.integer('id');
          t.string('text');
          t.index('id');
        },
      );
      await dbMssql.schema.createTable(tempParameter_statusappeditban, (t) => {
        t.integer('id');
        t.string('text');
        t.index('id');
      });
      await dbMssql.schema.createTable(
        tempParameter_statuslewatvalidasi,
        (t) => {
          t.integer('id');
          t.string('text');
          t.index('id');
        },
      );
      await dbMssql.schema.createTable(
        tempParameter_statusabsensisupir,
        (t) => {
          t.integer('id');
          t.string('text');
          t.index('id');
        },
      );
      await dbMssql.schema.createTable(
        tempParameter_statusapprovalhistorytradomilikmandor,
        (t) => {
          t.integer('id');
          t.string('text');
          t.index('id');
        },
      );
      await dbMssql.schema.createTable(tempmandor, (t) => {
        t.integer('id');
        t.string('namamandor');
        t.index('id');
      });
      await dbMssql.schema.createTable(tempsupir, (t) => {
        t.integer('id');
        t.string('namasupir');
        t.index('id');
      });

      const dataStatusAktif = await dbMssql('parameter')
        .select('id', 'text')
        .where('grp', 'STATUS AKTIF');
      const dataJenisPlat = await dbMssql('parameter')
        .select('id', 'text')
        .where('grp', 'JENIS PLAT');
      const dataStatusStandarisasi = await dbMssql('parameter')
        .select('id', 'text')
        .where('grp', 'STATUS STANDARISASI');
      const dataStatusMutasi = await dbMssql('parameter')
        .select('id', 'text')
        .where('grp', 'STATUS MUTASI');
      const datastatusvalidasikendaraan = await dbMssql('parameter')
        .select('id', 'text')
        .where('grp', 'STATUS VALIDASI KENDARAAN');
      const dataMobilStoring = await dbMssql('parameter')
        .select('id', 'text')
        .where('grp', 'STATUS MOBIL STORING');
      const dataApEditBan = await dbMssql('parameter')
        .select('id', 'text')
        .where('grp', 'STATUS APPROVAL EDIT BAN');
      const dataLewatValidasi = await dbMssql('parameter')
        .select('id', 'text')
        .where('grp', 'STATUS LEWAT VALIDASI');
      const dataAbsensiSupir = await dbMssql('parameter')
        .select('id', 'text')
        .where('grp', 'STATUS ABSENSI SUPIR');
      const dataMandor = await dbMssql('mandor').select('id', 'namamandor');
      const dataSupir = await dbMssql('supir').select('id', 'namasupir');
      // Create the table
      await dbMssql(tempParameter_statusaktif).insert({ id: null, text: null });
      await dbMssql(tempParameter_statusjenisplat).insert({
        id: null,
        text: null,
      });
      await dbMssql(tempParameter_statusstandarisasi).insert({
        id: null,
        text: null,
      });
      await dbMssql(tempParameter_statusmutasi).insert({
        id: null,
        text: null,
      });
      await dbMssql(tempParameter_statusvalidasikendaraan).insert({
        id: null,
        text: null,
      });
      await dbMssql(tempParameter_statusmobilstoring).insert({
        id: null,
        text: null,
      });
      await dbMssql(tempParameter_statusappeditban).insert({
        id: null,
        text: null,
      });
      await dbMssql(tempParameter_statuslewatvalidasi).insert({
        id: null,
        text: null,
      });
      await dbMssql(tempParameter_statusabsensisupir).insert({
        id: null,
        text: null,
      });
      await dbMssql(tempParameter_statuslewatvalidasi).insert({
        id: null,
        text: null,
      });
      await dbMssql(tempmandor).insert({ id: null, namamandor: null });
      await dbMssql(tempsupir).insert({ id: null, namasupir: null });

      await dbMssql(tempParameter_statusaktif).insert(dataStatusAktif);
      await dbMssql(tempParameter_statusjenisplat).insert(dataJenisPlat);
      await dbMssql(tempParameter_statusstandarisasi).insert(
        dataStatusStandarisasi,
      );
      await dbMssql(tempParameter_statusmutasi).insert(dataStatusMutasi);
      await dbMssql(tempParameter_statusvalidasikendaraan).insert(
        datastatusvalidasikendaraan,
      );
      await dbMssql(tempParameter_statusmobilstoring).insert(dataMobilStoring);
      await dbMssql(tempParameter_statusappeditban).insert(dataApEditBan);
      await dbMssql(tempParameter_statuslewatvalidasi).insert(
        dataLewatValidasi,
      );
      await dbMssql(tempParameter_statusabsensisupir).insert(dataAbsensiSupir);
      await dbMssql(tempmandor).insert(dataMandor);
      await dbMssql(tempsupir).insert(dataSupir);
      // Fetch the data from the temporary table to verify

      const datatempParameter_statusaktif = await dbMssql(
        tempParameter_statusaktif,
      );
      const result = await dbMssql(`${tempTable} as t`)
        .innerJoin(
          `${tempParameter_statusaktif} as statusaktiftemp`,
          dbMssql.raw('COALESCE(t.statusaktif, 0) = statusaktiftemp.id'),
        )
        .select(
          't.id as trado_id',
          't.kodetrado',
          't.keterangan',
          't.statusaktif',
          'statusaktiftemp.id as statusaktif_id', // kasih alias yang beda
        );

      return result;
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

  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    // Header export
    worksheet.mergeCells('A1:I1');
    worksheet.mergeCells('A2:I2');
    worksheet.mergeCells('A3:I3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN HARI LIBUR';
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
      'NO.',
      'TANGGAL',
      'KETERANGAN',
      'STATUS AKTIF',
      'CREATED AT',
    ];
    headers.forEach((header, index) => {
      const cell = worksheet.getCell(5, index + 1); // Baris 5 untuk header
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
      const currentRow = rowIndex + 6; // Mulai dari baris 6 setelah header

      worksheet.getCell(currentRow, 1).value = rowIndex + 1; // Nomor urut (ID)
      worksheet.getCell(currentRow, 2).value = row.tgl;
      worksheet.getCell(currentRow, 3).value = row.keterangan;
      worksheet.getCell(currentRow, 4).value = row.status;
      worksheet.getCell(currentRow, 5).value = row.created_at;

      // Menambahkan border untuk setiap cell
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

    // Mengatur lebar kolom
    worksheet.getColumn(1).width = 10; // Lebar untuk nomor urut
    worksheet.getColumn(2).width = 30;
    worksheet.getColumn(3).width = 30;
    worksheet.getColumn(4).width = 30;
    worksheet.getColumn(5).width = 15;

    // Simpan file Excel ke direktori sementara
    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_harilibur${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath; // Kembalikan path file sementara
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
        text,
        ...insertData
      } = data;

      // Convert the tgl value to a proper Date format
      if (insertData.tgl) {
        insertData.tgl = this.convertToDate(insertData.tgl);
      }

      const hasChanges = this.utilsService.hasChanges(insertData, existingData);
      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(insertData);
      }

      const query = trx(`${this.tableName} as u`)
        .select([
          'u.id as id',
          trx.raw("TO_CHAR(u.tgl, 'DD-MM-YYYY') AS tgl"),
          'u.keterangan',
          'u.statusaktif',
          'u.modifiedby',
          trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at"),
          trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at"),
          'p.memo',
          'p.text',
        ])
        .leftJoin('parameter as p', 'u.statusaktif', 'p.id')
        .orderBy(sortBy ? `u.${sortBy}` : 'u.id', sortDirection || 'desc');

      // Filtering logic remains the same...
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
      if (search) {
        query.where((builder) => {
          builder

            .orWhere('u.tgl', 'like', `%${search}%`)
            .orWhere('u.keterangan', 'like', `%${search}%`)
            .orWhere('u.email', 'like', `%${search}%`)

            .orWhere('p.memo', 'like', `%${search}%`)
            .orWhere('p.text', 'like', `%${search}%`);
        });
      }

      const filteredItems = await query;
      let itemIndex = filteredItems.findIndex((item) => Number(item.id) === id);
      if (itemIndex === -1) {
        itemIndex = 0;
      }
      const pageNumber = Math.floor(itemIndex / limit) + 1;
      const endIndex = pageNumber * limit;
      const limitedItems = filteredItems.slice(0, endIndex);
      await this.redisService.set(
        `${this.tableName}-allItems`,
        JSON.stringify(limitedItems),
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT OFFDAYS',
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

  // Function to convert 'dd-MM-yyyy' to a valid date format 'yyyy-MM-dd'
  convertToDate(dateString: string): string {
    const [day, month, year] = dateString.split('-');
    return `${year}-${month}-${day}`; // Convert to 'yyyy-MM-dd' format
  }

  async delete(id: string, trx: any) {
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
          postingdari: 'DELETE OFFDAYS',
          idtrans: deletedData.id,
          nobuktitrans: deletedData.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: deletedData.modifiedby,
        },
        trx,
      );

      return { status: 200, message: 'Data deleted successfully', deletedData };
    } catch (error) {
      console.error('Error deleting data:', error);
      if (error instanceof NotFoundException) {
        throw error; // Rethrow NotFoundException to return a 404 response
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }
}
