import { Module } from '@nestjs/common';
import Knex from 'knex';
import knexConfig from 'src/knexfile';

@Module({
  providers: [
    {
      provide: 'KNEX_CONNECTION',
      useFactory: () => {
        const environment = process.env.NODE_ENV || 'development'; // Atur environment sesuai kebutuhan
        return Knex(knexConfig[environment]);
      },
    },
  ],
  exports: ['KNEX_CONNECTION'],
})
export class KnexModule {}
