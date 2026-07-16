import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[supplier] (
  [relasi_id] varchar(200) NULL,
  [nama] nvarchar(MAX) NULL,
  [keterangan] nvarchar(MAX) NULL,
  [contactperson] varchar(100) NULL,
  [ktp] varchar(50) NULL,
  [alamat] nvarchar(MAX) NULL,
  [coa] nvarchar(100) NULL,
  [coapiu] nvarchar(100) NULL,
  [coahut] nvarchar(100) NULL,
  [coagiro] nvarchar(100) NULL,
  [kota] varchar(50) NULL,
  [kodepos] varchar(10) NULL,
  [telp] varchar(30) NULL,
  [email] varchar(50) NULL,
  [fax] varchar(30) NULL,
  [web] varchar(30) NULL,
  [creditterm] bigint NULL,
  [credittermplus] bigint NULL,
  [npwp] varchar(30) NULL,
  [alamatfakturpajak] varchar(500) NULL,
  [namapajak] varchar(50) NULL,
  [nominalpph21] money NULL,
  [nominalpph23] money NULL,
  [noskb] varchar(100) NULL,
  [tglskb] date NULL,
  [nosk] varchar(100) NULL,
  [tglsk] date NULL,
  [statusaktif] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_supplier] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[supplier];');
}
