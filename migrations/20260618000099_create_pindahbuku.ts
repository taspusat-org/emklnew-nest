import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[pindahbuku] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [tglbukti] date NULL,
  [bankdari_id] varchar(200) NULL,
  [bankke_id] varchar(200) NULL,
  [coadebet] nvarchar(100) NULL,
  [coakredit] nvarchar(100) NULL,
  [alatbayar_id] varchar(200) NULL,
  [nowarkat] nvarchar(100) NULL,
  [tgljatuhtempo] date NULL,
  [keterangan] nvarchar(MAX) NULL,
  [nominal] money NULL,
  [statusformat] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_pindahbuku] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[pindahbuku];');
}
