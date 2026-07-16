import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[panjarheader] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [tglbukti] datetime NULL,
  [jenisorder_id] varchar(200) NULL,
  [biayaemkl_id] varchar(200) NULL,
  [keterangan] nvarchar(MAX) NULL,
  [statusformat] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_panjarheader] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[panjarheader];');
}
