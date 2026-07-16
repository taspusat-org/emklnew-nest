import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[temp_jurnalumumheaderadmin] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [tglbukti] nvarchar(255) NULL,
  [keterangan] nvarchar(255) NULL,
  [postingdari] nvarchar(255) NULL,
  [statusformat] nvarchar(255) NULL,
  [keteranganapproval] nvarchar(255) NULL,
  [tglapproval] nvarchar(255) NULL,
  [statusapproval] nvarchar(255) NULL,
  [keterangancetak] nvarchar(255) NULL,
  [tglcetak] nvarchar(255) NULL,
  [statuscetak] nvarchar(255) NULL,
  [statusapproval_id] nvarchar(255) NULL,
  [statuscetak_id] nvarchar(255) NULL,
  [info] nvarchar(255) NULL,
  [modifiedby] nvarchar(255) NOT NULL DEFAULT (''),
  [updated_at] nvarchar(255) NOT NULL DEFAULT (CONVERT([nvarchar](30),getdate(),(126))),
  [created_at] nvarchar(255) NOT NULL DEFAULT (CONVERT([nvarchar](30),getdate(),(126))),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_temp_jurnalumumheaderadmin] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[temp_jurnalumumheaderadmin];');
}
