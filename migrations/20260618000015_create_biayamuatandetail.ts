import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[biayamuatandetail] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [orderanmuatan_nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [estimasi] money NULL,
  [nominal] money NULL,
  [keterangan] nvarchar(MAX) NULL,
  [biayaextra_nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [biayaextra_nobuktijson] nvarchar(MAX) NULL,
  [biaya_id] varchar(200) NULL,
  [id] varchar(200) NOT NULL,
  [biayamuatan_id] varchar(200) NULL,
  [biayaemkl_id] varchar(200) NULL,
  CONSTRAINT [PK_biayamuatandetail] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[biayamuatandetail];');
}
