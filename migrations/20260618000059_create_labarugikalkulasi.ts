import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[labarugikalkulasi] (
  [periode] varchar(10) NULL,
  [estkomisimarketing] money NULL,
  [komisimarketing] money NULL,
  [biayakantorpusat] money NULL,
  [biayatour] money NULL,
  [gajidireksi] money NULL,
  [estkomisikacab] money NULL,
  [biayabonustriwulan] money NULL,
  [estkomisimarketing2] money NULL,
  [estkomisikacabcabang1] money NULL,
  [estkomisikacabcabang2] money NULL,
  [statusfinalkomisimarketing] varchar(200) NULL,
  [statusfinalbonustriwulan] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_labarugikalkulasi] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[labarugikalkulasi];');
}
