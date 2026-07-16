import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[hutangdetail] (
  [hutang_id] varchar(200) NULL,
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [coa] nvarchar(100) NULL,
  [keterangan] nvarchar(MAX) NULL,
  [nominal] money NULL,
  [dpp] money NULL,
  [noinvoiceemkl] nvarchar(MAX) NULL,
  [tglinvoiceemkl] nvarchar(MAX) NULL,
  [nofakturpajakemkl] nvarchar(MAX) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_hutangdetail] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[hutangdetail];');
}
