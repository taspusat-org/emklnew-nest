import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[statusjob] (
  [statusjob] varchar(200) NULL,
  [job] varchar(100) NULL,
  [tglstatus] date NULL,
  [keterangan] nvarchar(MAX) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [jenisorder_id] varchar(200) NULL,
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_statusjob] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[statusjob];');
}
