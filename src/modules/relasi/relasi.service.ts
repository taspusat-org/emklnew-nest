import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateRelasiDto } from './dto/create-relasi.dto';
import { UpdateRelasiDto } from './dto/update-relasi.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { RunningNumberService } from '../running-number/running-number.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { RedisService } from 'src/common/redis/redis.service';
@Injectable()
export class RelasiService {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly runningNumberService: RunningNumberService,
  ) {}
  private readonly tableName = 'relasi';
  async create(createRelasiDto: any, trx: any) {
    try {
      const { ...insertData } = createRelasiDto;
      insertData.updated_at = this.utilsService.getTime();
      insertData.created_at = this.utilsService.getTime();
      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['nama', 'alamat', 'npwp', 'namapajak', 'alamatpajak'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      console.log('Query: INSERT INTO', this.tableName, 'Data:', insertData);
      const insertedItems = await trx(this.tableName)
        .insert(await withUuidV7(trx, insertData))
        .returning('*');
      console.log('Result insertedItems:', insertedItems);

      const newItem = insertedItems[0];
      console.log('newItem', newItem);
      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD RELASI',
          idtrans: newItem?.id,
          nobuktitrans: newItem?.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem?.modifiedby,
        },
        trx,
      );

      return {
        id: newItem?.id,
      };
    } catch (error) {
      throw new Error(`Error creating relasi: ${error.message}`);
    }
  }

  async findAll(
    { search, filters, pagination, sort, isLookUp }: FindAllParams,
    trx: any,
  ) {
    try {
      // default pagination
      let { page, limit } = pagination ?? {};

      page = page ?? 1;
      limit = limit ?? 0;

      // lookup mode: jika total > 500, kembalikan JSON saja
      if (isLookUp) {
        const cnt = await trx(this.tableName).count('id as total').first();
        const totalCount = Number(cnt?.total) || 0;
        if (totalCount > 500) {
          return { data: { type: 'json' } };
        }
        limit = 0;
      }

      // build query
      const query = trx(`${this.tableName} as r`)
        .select([
          'r.id',
          'r.statusrelasi',
          'r.nama',
          'r.coagiro',
          'r.coapiutang',
          'r.coahutang',
          'r.statustitip',
          'r.titipcabang_id',
          'r.alamat',
          'r.npwp',
          'r.namapajak',
          'r.alamatpajak',
          'r.statusaktif',
          'r.info',
          'r.modifiedby',
          // CATATAN: tabel `relasi` TIDAK punya kolom editing_by/editing_at.
          // Men-SELECT keduanya bikin MSSQL error 207 "Invalid column name" →
          // GET /relasi 500. Jangan tambah lagi tanpa migrasi kolomnya dulu.
          trx.raw("TO_CHAR(r.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(r.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'statusrelasi.text as statusrelasi_text',
          'statusrelasi.memo as statusrelasi_memo',
          'statustitip.text as statustitip_text',
          'statustitip.memo as statustitip_memo',
          'statusaktif.text as statusaktif_text',
          'statusaktif.memo as statusaktif_memo',
          'cabang.nama as titipcabang',
          'coagiro.keterangancoa as coagiro_ket',
          'coapiutang.keterangancoa as coapiutang_ket',
          'coahutang.keterangancoa as coahutang_ket',
        ])
        .leftJoin(
          'parameter as statusrelasi',
          'r.statusrelasi',
          'statusrelasi.id',
        )
        .leftJoin('parameter as statustitip', 'r.statustitip', 'statustitip.id')
        .leftJoin('parameter as statusaktif', 'r.statusaktif', 'statusaktif.id')
        .leftJoin('akunpusat as coagiro', 'r.coagiro', 'coagiro.coa')
        .leftJoin('akunpusat as coapiutang', 'r.coapiutang', 'coapiutang.coa')
        .leftJoin('akunpusat as coahutang', 'r.coahutang', 'coahutang.coa')
        .leftJoin('cabang', 'r.titipcabang_id', 'cabang.id');

      const excludeSearchKeys = [
        'titipcabang_id',
        'statusaktif',
        'statusaktif_text',
        'statusrelasi',
        'statustitip',
        'coagiro',
        'coapiutang',
        'coahutang',
      ];

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
              qb.orWhereRaw("TO_CHAR(r.??, 'DD-MM-YYYY HH24:MI:SS') like ?", [
                field,
                `%${sanitizedValue}%`,
              ]);
            } else if (field === 'coagiro_ket') {
              qb.orWhere(
                'coagiro.keterangancoa',
                'like',
                `%${sanitizedValue}%`,
              );
            } else if (field === 'statusrelasi_text') {
              qb.orWhere('statusrelasi.text', 'like', `%${sanitizedValue}%`);
            } else if (field === 'statustitip_text') {
              qb.orWhere('statustitip', 'like', `%${sanitizedValue}%`);
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
            } else if (field === 'titipcabang') {
              qb.orWhere('cabang.nama', 'like', `%${sanitizedValue}%`);
            } else {
              qb.orWhere(`r.${field}`, 'like', `%${sanitizedValue}%`);
            }
          });
        });
      }

      // filters per kolom
      if (filters) {
        for (const [key, rawValue] of Object.entries(filters)) {
          if (rawValue == null || rawValue === '') continue;
          const val = String(rawValue).replace(/\[/g, '[[]');

          // timestamp fields (editing_at dihapus: kolom tidak ada di tabel relasi)
          if (['created_at', 'updated_at'].includes(key)) {
            query.andWhereRaw("TO_CHAR(r.??, 'DD-MM-YYYY HH24:MI:SS') like ?", [
              key,
              `%${val}%`,
            ]);
          }
          // numeric fields
          else if (
            [
              'statusrelasi',
              'statustitip',
              'titipcabang_id',
              'statusaktif',
              'statusaktif_text',
            ].includes(key)
          ) {
            query.andWhere(`r.${key}`, Number(val));
          } else if (['statusrelasi_text'].includes(key)) {
            query.andWhere(`statusrelasi.text`, `${val}`);
          } else if (['statustitip_text'].includes(key)) {
            query.andWhere(`statustitip`, `${val}`);
          } else if (['statusaktif_text'].includes(key)) {
            query.andWhere(`statusaktif`, `${val}`);
          } else if (['titipcabang'].includes(key)) {
            query.andWhere(`cabang.nama`, `${val}`);
          } else if (key === 'coagiro_ket') {
            query.andWhere(`coagiro.keterangancoa`, 'like', `%${val}%`);
          } else if (key === 'coahutang_ket') {
            query.andWhere(`coahutang.keterangancoa`, 'like', `%${val}%`);
          } else if (key === 'coapiutang_ket') {
            query.andWhere(`coapiutang.keterangancoa`, 'like', `%${val}%`);
          }
          // text fields
          else if (
            [
              'nama',
              'coagiro',
              'coapiutang',
              'coahutang',
              'alamat',
              'npwp',
              'namapajak',
              'alamatpajak',
              'info',
              'modifiedby',
            ].includes(key)
          ) {
            query.andWhere(`r.${key}`, 'like', `%${val}%`);
          }
        }
      }

      // pagination
      if (limit > 0) {
        const offset = (page - 1) * limit;
        query.limit(limit).offset(offset);
      }

      // sorting
      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }

      // hitung total untuk pagination
      const tot = await trx(this.tableName).count('id as total').first();
      const totalItems = Number(tot?.total) || 0;
      const totalPages = limit > 0 ? Math.ceil(totalItems / limit) : 1;

      // eksekusi dan kembalikan hasil
      const data = await query;
      const responseType = totalItems > 500 ? 'json' : 'local';

      return {
        data,
        type: responseType,
        total: totalItems,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems,
          itemsPerPage: limit,
        },
      };
    } catch (error) {
      console.error('Error fetching relasi data:', error);
      throw new Error('Failed to fetch relasi data');
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} relasi`;
  }

  async update(id: string, data: any, trx: any) {
    try {
      const existingData = await trx(this.tableName).where('id', id).first();

      if (!existingData) {
        return;
      }
      const { ...insertData } = data;

      // Uppercase HANYA kolom teks manusiawi di bawah. Sisanya (id, *_id,
      // status*, dan kolom FK lain) adalah identifier: mayoritas id master
      // kini uuid v7 HURUF KECIL, jadi blanket uppercase menulis id yang
      // tidak ada. Tanpa FK, Postgres menerimanya diam-diam sehingga lookup
      // tampil kosong dan perubahan terlihat "tidak tersimpan" — lihat
      // pengeluaranheader.service.ts.
      ['nama', 'alamat', 'npwp', 'namapajak', 'alamatpajak'].forEach((field) => {
        if (typeof insertData[field] === 'string') {
          insertData[field] = insertData[field].toUpperCase();
        }
      });

      const hasChanges = this.utilsService.hasChanges(insertData, existingData);
      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(insertData);
      }
      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT RELASI',
          idtrans: id,
          nobuktitrans: id,
          aksi: 'EDIT',
          datajson: JSON.stringify(data),
          modifiedby: data.modifiedby,
        },
        trx,
      );

      return {
        updatedItem: {
          id,
        },
      };
    } catch (error) {
      console.error('Error updating relasi:', error);
      throw new Error('Failed to update relasi');
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
          postingdari: 'DELETE RELASI',
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
}
