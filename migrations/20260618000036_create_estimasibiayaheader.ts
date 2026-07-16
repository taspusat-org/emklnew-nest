import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[estimasibiayaheader] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [tglbukti] datetime NULL,
  [jenisorder_id] varchar(200) NULL,
  [orderan_nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [nominal] money NULL,
  [shipper_id] varchar(200) NULL,
  [statusppn] varchar(200) NULL,
  [asuransi_id] varchar(200) NULL,
  [comodity_id] varchar(200) NULL,
  [consignee_id] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_estimasibiayaheader] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[estimasibiayaheader];');
}
