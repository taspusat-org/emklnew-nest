import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[asuransi] (
  [nama] nvarchar(MAX) NULL,
  [keterangan] nvarchar(MAX) NULL,
  [contactperson] varchar(100) NULL,
  [alamat] nvarchar(MAX) NULL,
  [kota] varchar(500) NULL,
  [kodepos] varchar(100) NULL,
  [telp] varchar(300) NULL,
  [email] varchar(500) NULL,
  [fax] varchar(300) NULL,
  [web] varchar(300) NULL,
  [ratemodal] money NULL,
  [ratejual] money NULL,
  [npwp] varchar(30) NULL,
  [nominalasuransi] money NULL,
  [rateopendoor] money NULL,
  [adminbiaya] money NULL,
  [admintagih] money NULL,
  [batas1] money NULL,
  [batas2] money NULL,
  [batas3] money NULL,
  [materai1] money NULL,
  [materai2] money NULL,
  [materai3] money NULL,
  [statusaktif] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_asuransi] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[asuransi];');
}
