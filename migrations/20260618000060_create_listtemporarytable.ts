import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[listtemporarytable] (
  [namatabel] nvarchar(255) NULL,
  [namamenu] nvarchar(255) NULL,
  [modifiedby] nvarchar(255) NOT NULL DEFAULT (''),
  [created_at] nvarchar(255) NOT NULL DEFAULT (CONVERT([nvarchar](30),getdate(),(126))),
  [updated_at] nvarchar(255) NOT NULL DEFAULT (CONVERT([nvarchar](30),getdate(),(126))),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_listtemporarytable] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[listtemporarytable];');
}
