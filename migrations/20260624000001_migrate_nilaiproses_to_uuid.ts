import type { Knex } from 'knex';

/**
 * Migrasi kolom referensi parameter "NILAI PROSES" dari id integer lama ke UUID.
 *
 * Latar belakang:
 *  - parameter.id sudah dimigrasi menjadi UUID (varchar(200)).
 *  - Tetapi kolom pengeluaranemkl/penerimaanemkl.nilaiproses* masih bertipe
 *    bigint dan berisi id lama: 171 = POSITIF, 172 = NEGATIF.
 *  - Akibatnya validasi di pengeluaranheader.service & penerimaanheader.service
 *    (Number(nilaiproses) !== Number(dataPositif.id)) selalu gagal karena
 *    Number(uuid) = NaN -> setiap simpan pengeluaran/penerimaan dengan detail
 *    coaproses EMKL melempar 500.
 *
 * Migrasi: ubah tipe kolom -> varchar(200) lalu petakan 171/172 ke UUID
 * parameter POSITIF/NEGATIF. UUID di-resolve dinamis dari tabel parameter
 * sehingga aman untuk semua database (UUID berbeda tiap DB).
 */
const TABLES = ['pengeluaranemkl', 'penerimaanemkl'];
const COLUMNS = [
  'nilaiprosespengeluaran',
  'nilaiprosespenerimaan',
  'nilaiproseshutang',
];

export async function up(knex: Knex): Promise<void> {
  // 1) bigint -> varchar(200) agar bisa menampung UUID.
  for (const table of TABLES) {
    for (const col of COLUMNS) {
      await knex.schema.raw(
        `IF EXISTS (
           SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_NAME = '${table}' AND COLUMN_NAME = '${col}'
             AND DATA_TYPE = 'bigint'
         )
         ALTER TABLE [dbo].[${table}] ALTER COLUMN [${col}] varchar(200) NULL;`,
      );
    }
  }

  // 2) Petakan 171 -> id POSITIF, 172 -> id NEGATIF (per-DB lewat parameter).
  for (const table of TABLES) {
    for (const col of COLUMNS) {
      await knex.schema.raw(
        `UPDATE t SET t.[${col}] = p.id
           FROM [dbo].[${table}] t
           INNER JOIN [dbo].[parameter] p
             ON p.grp = 'NILAI PROSES'
            AND p.text = CASE t.[${col}]
                           WHEN '171' THEN 'POSITIF'
                           WHEN '172' THEN 'NEGATIF'
                         END
          WHERE t.[${col}] IN ('171', '172');`,
      );
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  // Balikkan: UUID POSITIF/NEGATIF -> 171/172, lalu kembalikan ke bigint.
  for (const table of TABLES) {
    for (const col of COLUMNS) {
      await knex.schema.raw(
        `UPDATE t SET t.[${col}] = CASE p.text
                                     WHEN 'POSITIF' THEN '171'
                                     WHEN 'NEGATIF' THEN '172'
                                   END
           FROM [dbo].[${table}] t
           INNER JOIN [dbo].[parameter] p ON p.id = t.[${col}]
          WHERE p.grp = 'NILAI PROSES';`,
      );
    }
  }

  for (const table of TABLES) {
    for (const col of COLUMNS) {
      await knex.schema.raw(
        `IF EXISTS (
           SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_NAME = '${table}' AND COLUMN_NAME = '${col}'
             AND DATA_TYPE = 'varchar'
         )
         ALTER TABLE [dbo].[${table}] ALTER COLUMN [${col}] bigint NULL;`,
      );
    }
  }
}
