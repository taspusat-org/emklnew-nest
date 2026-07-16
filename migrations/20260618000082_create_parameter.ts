import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[parameter] (
  [grp] nvarchar(255) NULL,
  [subgrp] nvarchar(255) NULL,
  [kelompok] nvarchar(255) NULL,
  [text] nvarchar(255) NULL,
  [memo] text NULL,
  [type] nvarchar(100) NULL,
  [default] nvarchar(255) NULL,
  [modifiedby] nvarchar(50) NOT NULL DEFAULT (''),
  [info] text NULL,
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_parameter] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[parameter];');
}
