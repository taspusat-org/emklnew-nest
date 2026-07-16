import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[cabang] (
  [kodecabang] nvarchar(255) NULL,
  [nomorcabang] varchar(10) NULL,
  [nama] nvarchar(MAX) NULL,
  [keterangan] nvarchar(MAX) NULL,
  [statusaktif] varchar(200) NULL,
  [cabang_id] varchar(200) NULL,
  [pelabuhan] nvarchar(MAX) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] nvarchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime2 NOT NULL DEFAULT (getdate()),
  [updated_at] datetime2 NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_cabang] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[cabang];');
}
