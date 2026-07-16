import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[shippinginstructiondetail] (
  [nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [shippinginstructiondetail_nobukti] nvarchar(100) NOT NULL DEFAULT (''),
  [shippinginstruction_id] varchar(200) NOT NULL,
  [asalpelabuhan] varchar(MAX) NULL,
  [keterangan] varchar(MAX) NULL,
  [consignee] varchar(MAX) NULL,
  [shipper] varchar(MAX) NULL,
  [comodity] varchar(MAX) NULL,
  [notifyparty] varchar(MAX) NULL,
  [statuspisahbl] varchar(200) NULL,
  [emkl_id] varchar(200) NULL,
  [containerpelayaran_id] varchar(200) NULL,
  [tujuankapal_id] varchar(200) NULL,
  [daftarbl_id] varchar(200) NULL,
  [statusformat] varchar(200) NULL,
  [info] nvarchar(MAX) NULL,
  [modifiedby] varchar(200) NOT NULL DEFAULT (''),
  [created_at] datetime NOT NULL DEFAULT (getdate()),
  [updated_at] datetime NOT NULL DEFAULT (getdate()),
  [tglbukti] date NULL,
  [totalgw] nvarchar(MAX) NULL,
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_shippinginstructiondetail] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[shippinginstructiondetail];');
}
