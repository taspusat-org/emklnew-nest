import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[bank] (
  [nama] nvarchar(100) NULL,
  [keterangan] nvarchar(MAX) NULL,
  [coa] nvarchar(100) NULL,
  [coagantung] nvarchar(100) NULL,
  [statusbank] varchar(200) NULL,
  [statusaktif] varchar(200) NULL,
  [statusdefault] varchar(200) NULL,
  [formatpenerimaan] varchar(200) NULL,
  [formatpengeluaran] varchar(200) NULL,
  [formatpenerimaangantung] varchar(200) NULL,
  [formatpengeluarangantung] varchar(200) NULL,
  [formatpencairan] varchar(200) NULL,
  [formatrekappenerimaan] varchar(200) NULL,
  [formatrekappengeluaran] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_bank] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[bank];');
}
