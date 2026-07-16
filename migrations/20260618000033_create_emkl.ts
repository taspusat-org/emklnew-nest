import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[emkl] (
  [statusrelasi] varchar(200) NULL,
  [relasi_id] varchar(200) NULL,
  [nama] nvarchar(MAX) NULL,
  [contactperson] nvarchar(200) NULL,
  [alamat] nvarchar(MAX) NULL,
  [coagiro] nvarchar(100) NULL,
  [coapiutang] nvarchar(100) NULL,
  [coahutang] nvarchar(100) NULL,
  [kota] nvarchar(200) NULL,
  [kodepos] nvarchar(100) NULL,
  [notelp] nvarchar(100) NULL,
  [email] nvarchar(200) NULL,
  [fax] nvarchar(100) NULL,
  [alamatweb] nvarchar(200) NULL,
  [top] money NULL,
  [npwp] nvarchar(100) NULL,
  [namapajak] nvarchar(MAX) NULL,
  [alamatpajak] nvarchar(MAX) NULL,
  [statustrado] varchar(200) NULL,
  [statusaktif] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_emkl] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[emkl];');
}
