import type { Knex } from 'knex';

// Kolom baru harus di akhir: CREATE OR REPLACE VIEW tidak boleh mengubah
// nama atau urutan kolom yang sudah ada.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`
    CREATE OR REPLACE VIEW vusers AS
    SELECT u.id,
      u.username,
      u.name,
      u.email,
      u.cabang_id,
      u.statusaktif,
      u.modifiedby,
      u.created_at,
      u.updated_at,
      p.text AS statusaktif_text,
      p.memo AS statusaktif_memo,
      c.nama AS cabang_nama,
      u.karyawan_id,
      k.nama AS karyawan_nama
    FROM users u
      LEFT JOIN parameter p ON u.statusaktif = p.id
      LEFT JOIN cabang c ON u.cabang_id = c.id
      LEFT JOIN karyawan k ON u.karyawan_id = k.id;
  `);
}

export async function down(knex: Knex): Promise<void> {
  // View tidak bisa kehilangan kolom lewat REPLACE, jadi harus di-drop dulu.
  await knex.schema.raw('DROP VIEW IF EXISTS vusers;');
  await knex.schema.raw(`
    CREATE VIEW vusers AS
    SELECT u.id,
      u.username,
      u.name,
      u.email,
      u.cabang_id,
      u.statusaktif,
      u.modifiedby,
      u.created_at,
      u.updated_at,
      p.text AS statusaktif_text,
      p.memo AS statusaktif_memo,
      c.nama AS cabang_nama
    FROM users u
      LEFT JOIN parameter p ON u.statusaktif = p.id
      LEFT JOIN cabang c ON u.cabang_id = c.id;
  `);
}
