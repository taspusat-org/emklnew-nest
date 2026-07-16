import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[menus] (
  [title] nvarchar(255) NOT NULL,
  [aco_id] varchar(200) NULL,
  [icon] nvarchar(255) NULL,
  [isActive] bit NULL,
  [parentId] varchar(200) NULL,
  [order] int NULL,
  [created_at] datetime2 NOT NULL DEFAULT (getdate()),
  [updated_at] datetime2 NOT NULL DEFAULT (getdate()),
  [statusaktif] varchar(200) NULL,
  [modifiedby] nvarchar(255) NOT NULL DEFAULT (''),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_menus] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[menus];');
}
