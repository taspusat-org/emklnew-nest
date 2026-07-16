import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[jurnalumumpusatdetail] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [tglbukti] date NULL,
  [coa] nvarchar(100) NULL,
  [coamain] nvarchar(100) NULL,
  [keterangan] nvarchar(MAX) NULL,
  [nominal] money NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  [jurnalumumpusat_id] varchar(200) NULL,
  CONSTRAINT [PK_jurnalumumpusatdetail] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[jurnalumumpusatdetail];');
}
