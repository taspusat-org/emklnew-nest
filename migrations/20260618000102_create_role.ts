import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[role] (
  [rolename] nvarchar(50) NULL,
  [modifiedby] nvarchar(50) NOT NULL DEFAULT (''),
  [created_at] datetime2 NOT NULL DEFAULT (getdate()),
  [updated_at] datetime2 NOT NULL DEFAULT (getdate()),
  [statusaktif] varchar(200) NULL,
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_role] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[role];');
}
