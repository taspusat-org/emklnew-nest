import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { CreateLockDto } from './dto/create-lock.dto';
import { UpdateLockDto } from './dto/update-lock.dto';
import { DateTime } from 'luxon';
import * as bcrypt from 'bcrypt';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { formatDateToSQL, UtilsService, uuidV7 } from 'src/utils/utils.service';

@Injectable()
export class LocksService {
  constructor(private readonly utilsService: UtilsService) {}
  private readonly tableName = 'locks';
  create(createLockDto: CreateLockDto) {
    return 'This action adds a new lock';
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
        const acoCountResult = await trx(this.tableName)
          .count('id as total')
          .first();

        const acoCount = acoCountResult?.total || 0;

        if (Number(acoCount) > 500) {
          return { data: { type: 'json' } };
        } else {
          limit = 0;
        }
      }

      const query = trx(`${this.tableName} as u`).select([
        'u.id as id',
        'u.table', // nobukti (nvarchar(100))
        trx.raw("TO_CHAR(u.editing_at, 'DD-MM-YYYY HH24:MI:SS') as editing_at"),
        'u.tableid', // keterangan (text)
        'u.editing_by', // relasi_id (integer)
        'u.info', // info (text)
        'u.modifiedby', // modifiedby (varchar(200))
        trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"), // created_at (datetime)
        trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"), // updated_at (datetime)
      ]);

      const excludeSearchKeys: string[] = []; // atau: [] as string[]

      const searchFields = Object.keys(filters ?? {}).filter(
        (k) =>
          !excludeSearchKeys.includes(k) &&
          Boolean((filters as Record<string, unknown>)[k]),
      );

      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            qb.orWhere(`u.${field}`, 'like', `%${sanitized}%`);
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          if (value) {
            if (
              key === 'created_at' ||
              key === 'updated_at' ||
              key === 'editing_at'
            ) {
              query.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?", [
                key,
                `%${sanitizedValue}%`,
              ]);
            } else {
              query.andWhere(`u.${key}`, 'like', `%${sanitizedValue}%`);
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

  findOne(id: string) {
    return `This action returns a #${id} lock`;
  }

  update(id: string, updateLockDto: UpdateLockDto) {
    return `This action updates a #${id} lock`;
  }

  remove(id: string) {
    return `This action removes a #${id} lock`;
  }
  async forceEdit(
    tableName: string,
    tableId: number,
    editingBy: string,
    trx: any,
  ) {
    try {
      // UTC sekarang
      const now = new Date();
      const nowMs = now.getTime();
      const utcNowIso = now.toISOString(); // simpan ini ke DB

      const existingLock = await trx('locks')
        .where('table', tableName)
        .andWhere('tableid', tableId)
        .first();
      if (existingLock && existingLock.editing_by === editingBy) {
        return {
          status: 'success',
          message: `Data pada table ${tableName} dengan ID ${tableId} sudah terkunci oleh Anda.`,
        };
      }

      if (!existingLock) {
        try {
          await trx('locks').insert({
            id: await uuidV7(trx),
            table: tableName,
            tableid: tableId,
            editing_by: editingBy,
            editing_at: utcNowIso, // <-- simpan UTC ISO
            info: `Data pada table ${tableName} dengan ID ${tableId} sedang diedit.`,
            modifiedby: editingBy,
            created_at: utcNowIso, // <-- simpan UTC ISO
            updated_at: utcNowIso, // <-- simpan UTC ISO
          });

          return {
            status: 'success',
            message: `Data pada table ${tableName} dengan ID ${tableId} berhasil dikunci untuk edit.`,
          };
        } catch (error) {
          console.error('[forceEdit] Error saat insert lock:', error);
          return {
            status: 'failed',
            message: `Terjadi kesalahan saat menyimpan data: ${error.message}`,
          };
        }
      }

      // --- cek expired pakai epoch UTC ---
      const lockedAtMs = new Date(existingLock.editing_at).getTime(); // Date dari driver sudah UTC-safe
      const diffMs = nowMs - lockedAtMs;
      const FIVE_MIN_MS = 5 * 60 * 1000;
      const expired = diffMs >= FIVE_MIN_MS;

      if (expired) {
        // timpa lock lama
        try {
          await trx('locks')
            .where('table', tableName)
            .andWhere('tableid', tableId)
            .update({
              editing_by: editingBy,
              editing_at: utcNowIso, // <-- update pakai UTC ISO
              info: `Data pada table ${tableName} dengan ID ${tableId} sedang diedit oleh ${editingBy}.`,
              modifiedby: editingBy,
              updated_at: utcNowIso, // <-- UTC ISO
            });

          return {
            status: 'success',
            message: `Lock lama (>5 menit) ditimpa. Sekarang ${editingBy} mengunci data ${tableName}#${tableId}.`,
          };
        } catch (error) {
          console.error(
            '[forceEdit] Error saat update lock (overwrite):',
            error,
          );
          return {
            status: 'failed',
            message: `Gagal menimpa lock lama: ${error.message}`,
          };
        }
      } else {
        // masih aktif → kasih sisa MENIT
        const remainingMs = FIVE_MIN_MS - Math.max(0, diffMs); // guard kalau diff negatif
        const remainingMin = Math.max(1, Math.ceil(remainingMs / 60000));

        return {
          status: 'failed',
          message: `Data sedang diedit oleh ${existingLock.editing_by}. Coba lagi dalam ~${remainingMin} menit. Atau Minta akses ke atasan anda.`,
        };
      }
    } catch (error) {
      console.error('[forceEdit] Unexpected error:', error);
      return {
        status: 'failed',
        message: `Unexpected error: ${error.message}`,
      };
    }
  }

  async openForceEdit(data: any, trx: any, modifiedby: string) {
    const now = this.utilsService.getTime();

    const { table, tableid, editing_by } = data;
    // Ensure that the column names are correct (e.g., 'table' => 'table_name' if necessary)
    const updatedRows = await trx('locks')
      .where('table', table) // Check if 'table' column exists or use the correct column name
      .andWhere('tableid', tableid) // Check if 'tableid' column exists or use the correct column name
      .update({
        editing_by: editing_by,
        editing_at: now,
        info: `Data pada table ${table} dengan ID ${tableid} sedang diedit oleh ${editing_by}.`,
        modifiedby: modifiedby,
        updated_at: now,
      });

    // Check if any rows were updated
    if (updatedRows === 0) {
      return {
        status: 'failed',
        message: `Data dengan ID ${tableid} tidak ditemukan atau tidak dapat diupdate.`,
      };
    }

    return {
      status: 'success',
      message: `Lock berhasil diperbarui oleh ${modifiedby}.`,
    };
  }
}
