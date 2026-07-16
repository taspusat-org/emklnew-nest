import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[acos] (
  [class] nvarchar(50) NULL,
  [method] nvarchar(50) NULL,
  [nama] nvarchar(150) NULL,
  [modifiedby] nvarchar(50) NOT NULL DEFAULT (''),
  [idheader] int NULL,
  [created_at] datetime2 NOT NULL DEFAULT (getdate()),
  [updated_at] datetime2 NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_acos] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[acos];');
}
