import type { Knex } from 'knex';

/**
 * Menyimpan hasil request mutasi per `Idempotency-Key`, supaya pengiriman ulang
 * request yang sama (user menekan SIMPAN lagi setelah melihat "Koneksi Timeout")
 * mengembalikan hasil yang pertama, bukan membuat data dobel.
 *
 * Barisnya sengaja ditulis di dalam transaksi yang sama dengan data bisnisnya:
 * kalau transaksinya di-rollback — mis. request timeout di backend — kuncinya
 * ikut hilang sehingga request memang boleh dikirim ulang.
 */
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('idempotencykey')) return;

  await knex.schema.createTable('idempotencykey', (table) => {
    table.string('id', 200).primary();
    table.string('key', 200).notNullable();
    table.string('method', 10).notNullable();
    table.string('endpoint', 255).notNullable();
    // sha256 payload: kunci sama + data berbeda = salah pakai di sisi klien.
    table.string('requesthash', 64).notNullable();
    table.integer('statuscode').notNullable();
    table.text('response').notNullable();
    table.string('modifiedby', 255).notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    // Unik per pemilik, bukan global: kalau dua klien kebetulan menghasilkan
    // kunci yang sama, jangan sampai yang satu menerima respons milik yang lain.
    table.unique(['key', 'modifiedby']);
  });

  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_idempotencykey_created_at ON idempotencykey (created_at);',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('idempotencykey');
}
