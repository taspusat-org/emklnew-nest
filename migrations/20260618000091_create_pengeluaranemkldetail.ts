import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[pengeluaranemkldetail] (
  [pengeluaranemklheader_id] varchar(200) NULL,
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [keterangan] nvarchar(MAX) NULL,
  [nominal] money NULL,
  [pengeluaranemkl_nobukti] nvarchar(100) NULL DEFAULT (''),
  [penerimaanemkl_nobukti] nvarchar(100) NULL DEFAULT (''),
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [noseal] varchar(100) NULL,
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_pengeluaranemkldetail] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[pengeluaranemkldetail];');
}
