import type { Knex } from 'knex';

/**
 * Menambahkan index pada `statuspendukung` dan `parameter`.
 *
 * Latar belakang: kedua tabel HANYA punya primary key. Padahal
 * UtilsService.tempPivotStatusPendukung — dipakai grid bookingorderanmuatan dan
 * orderan-muatan — menjalankan ini di SETIAP request:
 *
 *   FROM <tabel transaksi> a
 *   INNER JOIN statuspendukung b ON a.id = b.transaksi_id
 *   INNER JOIN parameter c ON b.statusdatapendukung = c.id
 *   INNER JOIN parameter d ON b.statuspendukung = d.id
 *   WHERE c.subgrp = '<TABEL>'
 *
 * Tanpa index: `statuspendukung` di-seq-scan penuh, dan `parameter` di-seq-scan
 * ULANG untuk setiap baris transaksi. Diukur di bookingorderanmuatan 100rb baris
 * / 1 juta baris statuspendukung:
 *
 *   tanpa index : 14.334 ms
 *   dengan index:    901 ms
 *
 * ~16x, dan efeknya kena ke SEMUA modul yang memakai statuspendukung.
 *
 * Catatan penting untuk `parameter.subgrp`: predikatnya harus ditulis
 * `c.subgrp = '<NILAI HURUF BESAR>'`, BUKAN `UPPER(c.subgrp) = ...`.
 * Membungkus kolomnya dengan UPPER() membuat predikat tidak sargable sehingga
 * idx_parameter_subgrp tidak terpakai sama sekali — dan waktunya balik ke 14 detik.
 *
 * Semua `IF NOT EXISTS` agar idempoten & aman dijalankan berulang.
 */
const INDEXES: { name: string; table: string; columns: string }[] = [
  // Join pivot: <tabel transaksi>.id -> statuspendukung.transaksi_id.
  {
    name: 'idx_statuspendukung_transaksi_id',
    table: 'statuspendukung',
    columns: 'transaksi_id',
  },
  // Filter c.subgrp di pivot. Tanpa ini tabel parameter di-seq-scan ULANG
  // untuk setiap baris transaksi.
  {
    name: 'idx_parameter_subgrp',
    table: 'parameter',
    columns: 'subgrp',
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
