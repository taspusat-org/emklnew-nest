import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[penerimaanheader] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [tglbukti] date NULL,
  [relasi_id] varchar(200) NULL,
  [keterangan] nvarchar(MAX) NULL,
  [bank_id] varchar(200) NULL,
  [postingdari] nvarchar(MAX) NULL,
  [coakasmasuk] nvarchar(100) NULL,
  [diterimadari] nvarchar(MAX) NULL,
  [alatbayar_id] varchar(200) NULL,
  [nowarkat] nvarchar(100) NULL,
  [tgllunas] date NULL,
  [noresi] nvarchar(MAX) NULL,
  [statusformat] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_penerimaanheader] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[penerimaanheader];');
}
