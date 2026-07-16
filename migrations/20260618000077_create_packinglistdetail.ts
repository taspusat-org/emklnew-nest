import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[packinglistdetail] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [packinglist_id] varchar(200) NOT NULL,
  [bongkarke] bigint NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [orderanmuatan_nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_packinglistdetail] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[packinglistdetail];');
}
