import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[kasgantungheader] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [tglbukti] date NULL,
  [relasi_id] varchar(200) NULL,
  [keterangan] nvarchar(MAX) NULL,
  [bank_id] varchar(200) NULL,
  [pengeluaran_nobukti] nvarchar(100) NULL,
  [coakaskeluar] nvarchar(100) NULL,
  [dibayarke] nvarchar(MAX) NULL,
  [alatbayar_id] varchar(200) NULL,
  [nowarkat] nvarchar(100) NULL,
  [tgljatuhtempo] date NULL,
  [gantungorderan_nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [info] nvarchar(MAX) NULL,
  [modifiedby] nvarchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime2 NOT NULL DEFAULT (getdate()),
  [updated_at] datetime2 NOT NULL DEFAULT (getdate()),
  [statusformat] varchar(200) NULL,
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_kasgantungheader] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[kasgantungheader];');
}
