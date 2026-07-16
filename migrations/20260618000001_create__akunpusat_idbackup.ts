import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`CREATE TABLE [dbo].[_akunpusat_idbackup] (
  [old_id] varchar(200) NOT NULL,
  [new_id] varchar(200) NULL,
  CONSTRAINT [PK__akunpusat_idbackup] PRIMARY KEY ([old_id])
);`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[_akunpusat_idbackup];');
}
