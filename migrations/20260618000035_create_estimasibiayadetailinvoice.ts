import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[estimasibiayadetailInvoice] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [estimasibiaya_id] varchar(200) NULL,
  [link_id] varchar(200) NULL,
  [biayaemkl_id] varchar(200) NULL,
  [nominal] money NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_estimasibiayadetailInvoice] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[estimasibiayadetailInvoice];');
}
