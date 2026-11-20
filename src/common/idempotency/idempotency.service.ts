import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { dbMssql } from 'src/common/utils/db';
import { withUuidV7 } from 'src/utils/utils.service';

const TABLE = 'idempotencykey';
const MAX_KEY_LENGTH = 200;
const UNIQUE_VIOLATION = '23505';
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface IdempotencyContext {
  key: string;
  hash: string;
  owner: string;
}

/**
 * Idempotency key untuk endpoint mutasi.
 *
 * Masalah yang diselesaikan: begitu koneksi putus atau timeout, browser tidak
 * pernah tahu apakah request-nya sempat di-commit backend. User menekan SIMPAN
 * lagi dan datanya jadi dobel. Dengan kunci yang sama, kiriman kedua
 * mengembalikan hasil kiriman pertama tanpa menulis apa pun.
 *
 * Pemakaian: `IdempotencyInterceptor` menyiapkan konteks + membalas kiriman
 * ulang SEBELUM pipe validasi jalan (kalau tidak, create yang diulang keburu
 * ditolak "username sudah ada"), controller cukup menyimpan hasilnya di
 * transaksi yang sama dengan data bisnisnya:
 *
 *   const result = await this.userService.create(data, trx);
 *   await this.idempotencyService.save(req, result, trx);
 *
 * dan di blok catch-nya:
 *
 *   const concurrent = await this.idempotencyService.replayAfterConflict(req, error);
 *   if (concurrent) return concurrent;
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  /**
   * Baca kunci dari header lalu simpan bersama hash payload-nya di request.
   * null = klien tidak memakai idempotency, semua alur berjalan seperti biasa.
   *
   * Hash dihitung DI SINI, sebelum pipe/controller menyentuh `req.body` —
   * ZodValidationPipe mengembalikan objek body yang sama (bukan salinan), jadi
   * `data.modifiedby = ...` di controller ikut mengubah body aslinya.
   */
  prepare(req: any): IdempotencyContext | null {
    if (!MUTATION_METHODS.has(String(req?.method).toUpperCase())) return null;

    const raw = req?.headers?.['idempotency-key'];
    const value = (Array.isArray(raw) ? raw[0] : raw) as unknown;
    if (typeof value !== 'string' || value.trim() === '') return null;

    if (value.length > MAX_KEY_LENGTH) {
      throw new BadRequestException('Idempotency-Key melebihi 200 karakter');
    }

    const context: IdempotencyContext = {
      key: value.trim(),
      hash: this.hash({ params: req?.params ?? {}, body: req?.body ?? {} }),
      // AuthGuard jalan sebelum interceptor, jadi req.user sudah terisi.
      owner: req?.user?.user?.username || 'unknown',
    };
    req.idempotency = context;
    return context;
  }

  contextOf(req: any): IdempotencyContext | null {
    return (req?.idempotency as IdempotencyContext) ?? null;
  }

  hash(payload: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(payload ?? {}))
      .digest('hex');
  }

  /**
   * Hasil yang sudah ter-commit untuk kunci ini, atau null bila belum pernah
   * dipakai. Sengaja di luar transaksi: yang dicari justru hasil request lain
   * yang sudah selesai. Kunci sama dengan payload berbeda ditolak — itu tanda
   * kunci dipakai ulang untuk data lain, bukan pengiriman ulang.
   *
   * Pencarian dibatasi pemiliknya supaya kunci yang kebetulan kembar antar user
   * tidak pernah saling membalas respons.
   */
  async findStored(context: IdempotencyContext): Promise<any | null> {
    const row = await dbMssql(TABLE)
      .where('key', context.key)
      .andWhere('modifiedby', context.owner)
      .first();
    if (!row) return null;

    if (row.requesthash !== context.hash) {
      throw new ConflictException(
        'Idempotency-Key sudah dipakai untuk data yang berbeda.',
      );
    }

    this.logger.warn(
      `replay idempotency key ${context.key} (${row.method} ${row.endpoint})`,
    );
    return JSON.parse(row.response);
  }

  /** No-op bila klien tidak mengirim kunci. */
  async save(
    req: any,
    result: unknown,
    trx: any,
    statusCode = 200,
  ): Promise<void> {
    const context = this.contextOf(req);
    if (!context) return;

    await trx(TABLE).insert(
      await withUuidV7(trx, {
        key: context.key,
        method: req?.method ?? 'POST',
        endpoint: req?.url ?? '',
        requesthash: context.hash,
        statuscode: statusCode,
        response: JSON.stringify(result ?? null),
        modifiedby: context.owner,
      }),
    );
  }

  /**
   * Dipakai di blok catch controller. Dua request dengan kunci sama yang jalan
   * BERSAMAAN (user klik dobel) tidak saling melihat karena masing-masing di
   * transaksi sendiri; yang kalah gagal di unique constraint. Setelah transaksi
   * yang kalah di-rollback, hasil milik pemenang sudah ter-commit dan bisa
   * dibaca lewat koneksi baru.
   */
  async replayAfterConflict(req: any, error: any): Promise<any | null> {
    const context = this.contextOf(req);
    if (!context || error?.code !== UNIQUE_VIOLATION) return null;

    const stored = await this.findStored(context);
    if (!stored) {
      throw new ConflictException(
        'Permintaan yang sama sedang diproses. Silakan muat ulang data.',
      );
    }
    return stored;
  }
}
