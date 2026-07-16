import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[relasi] (
  [statusrelasi] varchar(200) NULL,
  [nama] nvarchar(MAX) NULL,
  [coagiro] nvarchar(100) NULL,
  [coapiutang] nvarchar(100) NULL,
  [coahutang] nvarchar(100) NULL,
  [statustitip] varchar(200) NULL,
  [titipcabang_id] varchar(200) NULL,
  [alamat] nvarchar(MAX) NULL,
  [npwp] nvarchar(30) NULL,
  [namapajak] nvarchar(MAX) NULL,
  [alamatpajak] nvarchar(MAX) NULL,
  [statusaktif] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] nvarchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime2 NOT NULL DEFAULT (getdate()),
  [updated_at] datetime2 NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_relasi] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[relasi];');
}
