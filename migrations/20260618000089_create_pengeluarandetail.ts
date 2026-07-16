import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[pengeluaranDetail] (
  [pengeluaran_id] varchar(200) NULL,
  [coadebet] nvarchar(100) NULL,
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [keterangan] nvarchar(MAX) NULL,
  [nominal] money NULL,
  [dpp] money NULL,
  [transaksibiaya_nobukti] nvarchar(100) NULL DEFAULT (''),
  [transaksilain_nobukti] nvarchar(100) NULL DEFAULT (''),
  [noinvoiceemkl] nvarchar(100) NULL,
  [tglinvoiceemkl] date NULL,
  [nofakturpajakemkl] nvarchar(100) NULL,
  [perioderefund] varchar(10) NULL,
  [pengeluaranemklheader_nobukti] nvarchar(100) NULL DEFAULT (''),
  [penerimaanemklheader_nobukti] nvarchar(100) NULL DEFAULT (''),
  [kasgantung_nobukti] nvarchar(100) NULL DEFAULT (''),
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_pengeluaranDetail] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[pengeluaranDetail];');
}
