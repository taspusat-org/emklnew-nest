import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[scheduledetail] (
  [schedule_id] varchar(200) NULL,
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [pelayaran_id] varchar(200) NULL,
  [kapal_id] varchar(200) NULL,
  [tujuankapal_id] varchar(200) NULL,
  [schedulekapal_id] varchar(200) NULL,
  [tglberangkat] date NULL,
  [tgltiba] date NULL,
  [etb] date NULL,
  [eta] date NULL,
  [etd] date NULL,
  [voyberangkat] nvarchar(100) NOT NULL,
  [voytiba] nvarchar(100) NOT NULL,
  [closing] datetime NULL,
  [etatujuan] date NULL,
  [etdtujuan] date NULL,
  [keterangan] nvarchar(MAX) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] nvarchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_scheduledetail] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[scheduledetail];');
}
