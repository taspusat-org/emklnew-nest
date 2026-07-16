import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[pengembaliankasgantungheader] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [tglbukti] date NOT NULL,
  [keterangan] nvarchar(MAX) NULL,
  [bank_id] varchar(200) NULL,
  [penerimaan_nobukti] nvarchar(100) NULL DEFAULT (''),
  [coakasmasuk] nvarchar(100) NULL,
  [relasi_id] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] nvarchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime2 NOT NULL DEFAULT (getdate()),
  [updated_at] datetime2 NOT NULL DEFAULT (getdate()),
  [statusformat] varchar(200) NULL,
  [alatbayar_id] varchar(200) NULL,
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_pengembaliankasgantungheader] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[pengembaliankasgantungheader];');
}
