import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[shippinginstructionheader] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [schedule_id] varchar(200) NULL,
  [statusformat] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [tglbukti] date NULL,
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_shippinginstructionheader] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[shippinginstructionheader];');
}
