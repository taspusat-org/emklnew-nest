import type { Knex } from 'knex';

/**
 * Menambahkan index pada tabel shipping instruction (header, detail, rincian).
 *
 * Latar belakang:
 *  - `shippinginstructionheader` hanya punya PK (id) + unique (nobukti). Kolom
 *    `tglbukti` — satu-satunya kolom yang disaring view `vshippinginstructionheader`
 *    lewat session context `tas.si_tgldari` / `tas.si_tglsampai` — tidak
 *    ter-index sama sekali. Filter di view jadi percuma: Postgres tetap harus
 *    membaca seluruh heap dulu baru memangkas, dan COUNT untuk totalPages grid
 *    ikut membayarnya di SETIAP request halaman.
 *  - `shippinginstructiondetail` dan `shippinginstructiondetailrincian` bahkan
 *    hanya punya PK. Padahal keduanya SELALU dibaca dengan
 *    `where shippinginstruction_id = ?` / `where shippinginstructiondetail_id = ?`
 *    dan itu terjadi tiap kali baris master di grid berpindah.
 *
 * Perbaikan: index composite (kolom filter, kolom sort default) sehingga satu
 * index melayani WHERE sekaligus ORDER BY — Postgres tidak perlu Sort node lagi
 * untuk halaman pertama detail/rincian.
 *
 * Kolom sort lain di grid header (pelayaran_nama, kapal_nama, tujuankapal_nama)
 * datang dari `schedulekapal` lewat view, jadi tidak bisa ditolong index di
 * tabel ini. Kalau nanti sort itu terasa lambat, indexnya harus dipasang di
 * `schedulekapal` — di luar cakupan migration ini.
 *
 * Semua `IF NOT EXISTS` agar idempoten & aman dijalankan berulang.
 */
const INDEXES: { name: string; table: string; columns: string }[] = [
  // Filter periode di view + COUNT totalPages.
  {
    name: 'idx_shippinginstructionheader_tglbukti',
    table: 'shippinginstructionheader',
    columns: 'tglbukti',
  },
  // Kolom sortable lain milik tabel base (nobukti sudah punya unique index).
  {
    name: 'idx_shippinginstructionheader_created_at',
    table: 'shippinginstructionheader',
    columns: 'created_at',
  },
  {
    name: 'idx_shippinginstructionheader_updated_at',
    table: 'shippinginstructionheader',
    columns: 'updated_at',
  },
  {
    name: 'idx_shippinginstructionheader_modifiedby',
    table: 'shippinginstructionheader',
    columns: 'modifiedby',
  },
  // WHERE shippinginstruction_id = ? ORDER BY shippinginstructiondetail_nobukti.
  {
    name: 'idx_shippinginstructiondetail_si_nobukti',
    table: 'shippinginstructiondetail',
    columns: 'shippinginstruction_id, shippinginstructiondetail_nobukti',
  },
  // WHERE shippinginstructiondetail_id = ? ORDER BY shippinginstructiondetail_nobukti.
  {
    name: 'idx_shippinginstructiondetailrincian_detail_nobukti',
    table: 'shippinginstructiondetailrincian',
    columns: 'shippinginstructiondetail_id, shippinginstructiondetail_nobukti',
  },
];

export async function up(knex: Knex): Promise<void> {
  for (const idx of INDEXES) {
    await knex.schema.raw(
      `CREATE INDEX IF NOT EXISTS ${idx.name} ON ${idx.table} (${idx.columns});`,
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const idx of INDEXES) {
    await knex.schema.raw(`DROP INDEX IF EXISTS ${idx.name};`);
  }
}
