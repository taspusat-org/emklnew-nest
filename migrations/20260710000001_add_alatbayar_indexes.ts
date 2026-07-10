import type { Knex } from 'knex';

/**
 * Menambahkan index yang hilang pada tabel `alatbayar`.
 *
 * Latar belakang:
 *  - Setelah migrasi ke PostgreSQL, tabel `alatbayar` sama sekali TIDAK punya
 *    index (bahkan tidak ada primary key / unique index pada `id`).
 *  - Akibatnya:
 *      • GET /alatbayar (view valatbayar, ORDER BY nama) mem-full-scan +
 *        sort seluruh baris  -> ~5 detik, dan jauh lebih lama saat ada filter
 *        pencarian, sehingga menembus batas TimeoutInterceptor (30 dtk) -> 408.
 *      • Setiap create/update/delete melakukan `where('id', ...).first()` yang
 *        juga men-seq-scan seluruh tabel.
 *
 * Perbaikan:
 *  - idx_alatbayar_id   : UNIQUE index pada id -> lookup by id jadi ~1ms.
 *  - idx_alatbayar_nama : index pada kolom sort default -> ORDER BY nama LIMIT
 *    memakai index scan (dari ~4.8s menjadi ~28ms).
 *
 * Catatan: memakai `CREATE INDEX IF NOT EXISTS` (didukung PostgreSQL) supaya
 * aman dijalankan berulang / pada database yang indexnya sudah dibuat manual.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_alatbayar_id ON alatbayar (id)`,
  );
  await knex.schema.raw(
    `CREATE INDEX IF NOT EXISTS idx_alatbayar_nama ON alatbayar (nama)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw(`DROP INDEX IF EXISTS idx_alatbayar_nama`);
  await knex.schema.raw(`DROP INDEX IF EXISTS idx_alatbayar_id`);
}
