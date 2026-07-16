import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[shippinginstructiondetailrincian] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [shippinginstructiondetail_id] varchar(200) NOT NULL,
  [shippinginstructiondetail_nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [orderanmuatan_nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [comodity] nvarchar(MAX) NULL,
  [keterangan] nvarchar(MAX) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_shippinginstructiondetailrincian] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[shippinginstructiondetailrincian];');
}
