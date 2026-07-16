import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[marketing] (
  [nama] nvarchar(MAX) NULL,
  [keterangan] nvarchar(MAX) NULL,
  [statusaktif] varchar(200) NULL,
  [email] nvarchar(MAX) NULL,
  [karyawan_id] varchar(200) NULL,
  [tglmasuk] date NULL,
  [cabang_id] varchar(200) NULL,
  [statustarget] varchar(200) NULL,
  [statusbagifee] varchar(200) NULL,
  [statusfeemanager] varchar(200) NULL,
  [marketingmanager_id] varchar(200) NULL,
  [marketinggroup_id] varchar(200) NULL,
  [statusprafee] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [marketingcrm_id] varchar(200) NULL,
  [kode] varchar(10) NULL,
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_marketing] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[marketing];');
}
