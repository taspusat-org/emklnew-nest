import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[shipperprospek] (
  [marketing_id] varchar(200) NULL,
  [kodeprospek] varchar(50) NULL,
  [namashipperprospek] nvarchar(MAX) NULL,
  [parentshipper_id] varchar(200) NULL,
  [namashipper] nvarchar(MAX) NULL,
  [npwp] varchar(30) NULL,
  [nik] varchar(30) NULL,
  [npwpnik] varchar(16) NULL,
  [nitku] varchar(22) NULL,
  [alamatfakturpajak] nvarchar(MAX) NULL,
  [alamatkantor] nvarchar(MAX) NULL,
  [namapemilik] varchar(100) NULL,
  [telp] nvarchar(MAX) NULL,
  [fax] varchar(30) NULL,
  [email] nvarchar(MAX) NULL,
  [website] nvarchar(MAX) NULL,
  [contactperson] nvarchar(MAX) NULL,
  [notelp] nvarchar(MAX) NULL,
  [creditterm] money NULL,
  [prosedurpenagihan] nvarchar(MAX) NULL,
  [syaratpenagihan] nvarchar(MAX) NULL,
  [pickeuangan] varchar(100) NULL,
  [notelpkeuangan] varchar(100) NULL,
  [latarbelakangkepemilikankantor] nvarchar(MAX) NULL,
  [jenisusaha] nvarchar(MAX) NULL,
  [volumeperbulan] nvarchar(MAX) NULL,
  [kompetitor] nvarchar(MAX) NULL,
  [referensi] nvarchar(MAX) NULL,
  [usercabang] varchar(50) NULL,
  [tgltransfer] datetime NULL,
  [nominalplafon] money NULL,
  [initial] nvarchar(MAX) NULL,
  [tipe] nvarchar(MAX) NULL,
  [transferdari] nvarchar(MAX) NULL,
  [atasnama] nvarchar(MAX) NULL,
  [norekening] nvarchar(MAX) NULL,
  [bank] nvarchar(MAX) NULL,
  [keterangan] nvarchar(MAX) NULL,
  [statusaktif] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_shipperprospek] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[shipperprospek];');
}
