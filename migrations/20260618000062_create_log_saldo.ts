import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[log_saldo] (
  [tanggal] date NULL,
  [jenistransaksi] nvarchar(255) NULL,
  [created_at] datetime2 NOT NULL DEFAULT (getdate()),
  [updated_at] datetime2 NOT NULL DEFAULT (getdate()),
  [id] varchar(200) NOT NULL,
  CONSTRAINT [PK_log_saldo] PRIMARY KEY ([id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[log_saldo];');
}
