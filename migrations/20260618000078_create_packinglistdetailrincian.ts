import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[packinglistdetailrincian] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [packinglistdetail_id] varchar(200) NOT NULL,
  [statuspackinglist_id] varchar(200) NULL,
  [keterangan] nvarchar(MAX) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [banyak] nvarchar(MAX) NULL,
  [berat] nvarchar(MAX) NULL,
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_packinglistdetailrincian] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[packinglistdetailrincian];');
}
