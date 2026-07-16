import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[marketingbiaya] (
  [marketing_id] varchar(200) NULL,
  [jenisbiayamarketing_id] varchar(200) NULL,
  [nominal] money NULL,
  [statusaktif] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_marketingbiaya] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[marketingbiaya];');
}
