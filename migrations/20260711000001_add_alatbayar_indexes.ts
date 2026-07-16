import type { Knex } from 'knex';

/**
 * Menambahkan index pada tabel `alatbayar`.
 *
 * Latar belakang:
 *  - Tabel `alatbayar` TIDAK memiliki index sama sekali — primary key pun tidak
 *    terpasang. Migration `create_alatbayar` memakai sintaks SQL Server
 *    (`[dbo]`, `nvarchar(MAX)`, `PRIMARY KEY`) yang tidak pernah jalan di
 *    Postgres; skema/isi tabel akhirnya diisi lewat import data langsung
 *    sehingga PK & index tidak ikut terbentuk.
 *  - Akibatnya setiap `findAll` (buka grid Alat Bayar) melakukan Parallel Seq
 *    Scan seluruh baris + Sort penuh berdasarkan `nama`. Pada dataset besar
 *    (~1 juta baris) satu query data ~524ms. Saat grid dibuka ada ~7 request
 *    berbarengan (bulk limit 250 + refetch limit 50 + 5 prefetch), masing-masing
 *    juga menjalankan COUNT(*) atas view 4-JOIN — DB kewalahan dan grid
 *    "loading terus" / tidak pernah selesai. Modul lain (mis. `bank`) tidak
 *    terasa karena barisnya sedikit.
 *
 * Perbaikan: tambahkan index pada kolom yang dipakai untuk ORDER BY / lookup.
 *  - id (UNIQUE) -> lookup `where id = ...` pada create/update/delete + pengganti
 *    primary key yang hilang.
 *  - nama        -> default sort grid (`ORDER BY ab.nama`). Query 524ms -> ~16ms.
 *  - created_at, updated_at, keterangan, modifiedby -> kolom sortable lainnya.
 *
 * Semua `IF NOT EXISTS` agar idempoten & aman dijalankan berulang.
 */
const INDEXES: { name: string; column: string; unique?: boolean }[] = [
  { name: 'idx_alatbayar_id', column: 'id', unique: true },
  { name: 'idx_alatbayar_nama', column: 'nama' },
  { name: 'idx_alatbayar_created_at', column: 'created_at' },
  { name: 'idx_alatbayar_updated_at', column: 'updated_at' },
  { name: 'idx_alatbayar_keterangan', column: 'keterangan' },
  { name: 'idx_alatbayar_modifiedby', column: 'modifiedby' },
];

export async function up(knex: Knex): Promise<void> {
  for (const idx of INDEXES) {
    await knex.schema.raw(
      `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${idx.name} ON alatbayar (${idx.column});`,
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const idx of INDEXES) {
    await knex.schema.raw(`DROP INDEX IF EXISTS ${idx.name};`);
  }
}
