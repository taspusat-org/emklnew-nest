import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[penerimaanemkl] (
  [nama] nvarchar(MAX) NULL,
  [keterangan] nvarchar(MAX) NULL,
  [coadebet] nvarchar(100) NULL,
  [coakredit] nvarchar(100) NULL,
  [coapostingkasbankdebet] nvarchar(100) NULL,
  [coapostingkasbankkredit] nvarchar(100) NULL,
  [coapostinghutangdebet] nvarchar(100) NULL,
  [coapostinghutangkredit] nvarchar(100) NULL,
  [format] varchar(200) NULL,
  [statusaktif] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [coaproses] nvarchar(100) NULL,
  [nilaiprosespenerimaan] bigint NULL,
  [statuspenarikan] varchar(200) NULL,
  [nilaiprosespengeluaran] bigint NULL,
  [nilaiproseshutang] bigint NULL,
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_penerimaanemkl] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[penerimaanemkl];');
}
