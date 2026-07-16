import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[penerimaanemklheader] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [tglbukti] date NULL,
  [tgljatuhtempo] date NULL,
  [keterangan] nvarchar(MAX) NULL,
  [karyawan_id] varchar(200) NULL,
  [jenisposting] bigint NULL,
  [bank_id] varchar(200) NULL,
  [nowarkat] nvarchar(100) NULL,
  [pengeluaran_nobukti] nvarchar(100) NULL,
  [hutang_nobukti] nvarchar(100) NULL DEFAULT (''),
  [statusformat] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [penerimaan_nobukti] nvarchar(100) NULL DEFAULT (''),
  [penerimaanemkl_id] varchar(200) NULL,
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_penerimaanemklheader] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[penerimaanemklheader];');
}
