import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[bldetail] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [bl_nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [bl_id] varchar(200) NULL,
  [keterangan] varchar(MAX) NULL,
  [noblconecting] varchar(200) NULL,
  [shippinginstructiondetail_nobukti] varchar(MAX) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_bldetail] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[bldetail];');
}
