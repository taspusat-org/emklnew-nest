import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[penerimaandetail] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [penerimaan_id] varchar(200) NULL,
  [coa] nvarchar(100) NULL,
  [keterangan] nvarchar(MAX) NULL,
  [nominal] money NULL,
  [transaksibiaya_nobukti] nvarchar(100) NULL DEFAULT (''),
  [transaksilain_nobukti] nvarchar(100) NULL DEFAULT (''),
  [pengeluaranemklheader_nobukti] nvarchar(100) NULL DEFAULT (''),
  [penerimaanemklheader_nobukti] nvarchar(100) NULL DEFAULT (''),
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [pengembaliankasgantung_nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_penerimaandetail] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[penerimaandetail];');
}
