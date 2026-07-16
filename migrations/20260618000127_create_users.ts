import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[users] (
  [username] nvarchar(255) NULL,
  [name] nvarchar(255) NULL,
  [password] nvarchar(255) NULL,
  [email] nvarchar(255) NULL,
  [menu] nvarchar(MAX) NULL,
  [statusaktif] varchar(200) NULL,
  [modifiedby] nvarchar(255) NOT NULL DEFAULT (''),
  [created_at] datetime2 NOT NULL DEFAULT (getdate()),
  [updated_at] datetime2 NOT NULL DEFAULT (getdate()),
  [cabang_id] varchar(200) NULL,
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_users] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[users];');
}
