import type { Knex } from 'knex';

/**
 * Menambahkan index pada tabel booking orderan (header & muatan).
 *
 * Latar belakang: kedua tabel HANYA punya primary key. Padahal jalur baca
 * grid (BookingOrderanMuatanService.findAll) selalu:
 *  - join `bookingorderanmuatan.nobukti` -> `bookingorderanheader.nobukti`
 *  - menyaring `header.tglbukti` (periode dari FilterGrid)
 *  - menyaring `header.jenisorder_id`
 * dan jalur tulis selalu menyaring `bookingorderan_id`.
 *
 * Tanpa index ini setiap pembukaan grid dan setiap pergeseran window men-scan
 * seluruh kedua tabel.
 *
 * Catatan: nobukti di kedua tabel TIDAK dibuat UNIQUE di sini. Secara bisnis
 * satu header memang punya banyak baris muatan dengan nobukti yang sama, dan
 * untuk header-nya keunikan sebaiknya ditegakkan lewat constraint tersendiri
 * setelah data lama diperiksa — bukan diam-diam lewat migration index.
 *
 * Semua `IF NOT EXISTS` agar idempoten & aman dijalankan berulang.
 */
const INDEXES: { name: string; table: string; columns: string }[] = [
  // Komposit (jenisorder_id, tglbukti) — gaya yang sama dengan
  // idx_biayaextraheader_jenisorder_tglbukti: satu index melayani filter
  // periode DAN filter jenis order sekaligus, jadi tidak perlu index tglbukti
  // terpisah.
  {
    name: 'idx_bookingorderanheader_jenisorder_tglbukti',
    table: 'bookingorderanheader',
    columns: 'jenisorder_id, tglbukti',
  },
  // Join muatan -> header dan pivot status, keduanya lewat nobukti.
  {
    name: 'idx_bookingorderanmuatan_nobukti',
    table: 'bookingorderanmuatan',
    columns: 'nobukti',
  },
  // Dipakai jalur TULIS (hapus/ganti baris muatan saat simpan).
  {
    name: 'idx_bookingorderanmuatan_bookingorderan_id',
    table: 'bookingorderanmuatan',
    columns: 'bookingorderan_id',
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
