import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[pengeluaranemklgantungdetail] (
  [pengeluaranemklgantungheader_id] varchar(200) NULL,
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [keterangan] nvarchar(MAX) NULL,
  [nominal] money NULL,
  [pengeluaranemklgantung_nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [penerimaanemklgantung_nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [noseal] varchar(100) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_pengeluaranemklgantungdetail] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[pengeluaranemklgantungdetail];');
}
