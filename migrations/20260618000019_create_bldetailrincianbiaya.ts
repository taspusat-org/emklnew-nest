import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[bldetailrincianbiaya] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [bldetail_id] varchar(200) NULL,
  [bldetail_nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [orderanmuatan_nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [nominal] money NULL,
  [biayaemkl_id] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_bldetailrincianbiaya] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[bldetailrincianbiaya];');
}
