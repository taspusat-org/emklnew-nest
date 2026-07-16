import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[logtrail] (
  [postingdari] nvarchar(MAX) NOT NULL,
  [idtrans] nvarchar(MAX) NULL,
  [nobuktitrans] nvarchar(100) NOT NULL DEFAULT (''),
  [aksi] nvarchar(255) NULL,
  [datajson] nvarchar(MAX) NULL,
  [info] nvarchar(MAX) NULL,
  [created_at] datetime2 NOT NULL DEFAULT (getdate()),
  [updated_at] datetime2 NOT NULL DEFAULT (getdate()),
  [modifiedby] nvarchar(255) NOT NULL DEFAULT (''),
  [namatabel] nvarchar(255) NULL,
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_logtrail] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[logtrail];');
}
