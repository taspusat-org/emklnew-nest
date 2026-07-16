import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[pengembaliankasgantungdetail] (
  [pengembaliankasgantung_id] varchar(200) NULL,
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [kasgantung_nobukti] nvarchar(100) NULL DEFAULT (''),
  [keterangan] nvarchar(MAX) NULL,
  [nominal] money NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] nvarchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime2 NOT NULL DEFAULT (getdate()),
  [updated_at] datetime2 NOT NULL DEFAULT (getdate()),
  [penerimaandetail_id] varchar(200) NULL,
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_pengembaliankasgantungdetail] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[pengembaliankasgantungdetail];');
}
