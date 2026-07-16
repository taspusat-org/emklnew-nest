import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[biayaextramuatandetail] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [biayaextra_id] varchar(200) NULL,
  [orderanmuatan_nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [estimasi] money NULL,
  [nominal] money NULL,
  [statustagih] varchar(200) NULL,
  [nominaltagih] money NULL,
  [keterangan] nvarchar(MAX) NULL,
  [groupbiayaextra_id] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_biayaextramuatandetail] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[biayaextramuatandetail];');
}
