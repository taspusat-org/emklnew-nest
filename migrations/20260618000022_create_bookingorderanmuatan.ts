import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[bookingorderanmuatan] (
  [bookingorderan_id] varchar(200) NULL,
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [container_id] varchar(200) NULL,
  [shipper_id] varchar(200) NULL,
  [tujuankapal_id] varchar(200) NULL,
  [marketing_id] varchar(200) NULL,
  [keterangan] nvarchar(MAX) NULL,
  [schedule_id] varchar(200) NULL,
  [pelayarancontainer_id] varchar(200) NULL,
  [jenismuatan_id] varchar(200) NULL,
  [sandarkapal_id] varchar(200) NULL,
  [nopolisi] varchar(100) NULL,
  [nosp] varchar(100) NULL,
  [nocontainer] varchar(100) NULL,
  [noseal] varchar(1000) NULL,
  [lokasistuffing] bigint NULL,
  [nominalstuffing] money NULL,
  [emkl_id] varchar(200) NULL,
  [asalmuatan] varchar(1000) NULL,
  [daftarbl_id] varchar(200) NULL,
  [comodity] nvarchar(MAX) NULL,
  [gandengan] varchar(100) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_bookingorderanmuatan] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[bookingorderanmuatan];');
}
