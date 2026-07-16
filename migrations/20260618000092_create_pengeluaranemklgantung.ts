import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[pengeluaranemklgantung] (
  [nama] nvarchar(MAX) NULL,
  [keterangan] nvarchar(MAX) NULL,
  [format] varchar(200) NULL,
  [statusaktif] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_pengeluaranemklgantung] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[pengeluaranemklgantung];');
}
