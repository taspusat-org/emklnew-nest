import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[schedulekapal] (
  [jenisorder_id] varchar(200) NULL,
  [voyberangkat] nvarchar(MAX) NULL,
  [keterangan] nvarchar(MAX) NULL,
  [kapal_id] varchar(200) NULL,
  [pelayaran_id] varchar(200) NULL,
  [tujuankapal_id] varchar(200) NULL,
  [asalkapal_id] varchar(200) NULL,
  [tglberangkat] date NULL,
  [tgltiba] date NULL,
  [tglclosing] date NULL,
  [statusberangkatkapal] nvarchar(100) NULL,
  [statustibakapal] nvarchar(100) NULL,
  [batasmuatankapal] nvarchar(100) NULL,
  [statusaktif] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] nvarchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime2 NOT NULL DEFAULT (getdate()),
  [updated_at] datetime2 NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_schedulekapal] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[schedulekapal];');
}
