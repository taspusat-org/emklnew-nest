import { Module } from '@nestjs/common';
import { TradoController } from './trado.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { AuthModule } from '../auth/auth.module';
import { RelasiModule } from '../relasi/relasi.module';
import { TradoService } from './trado.service';

@Module({
  imports: [RedisModule, UtilsModule, AuthModule, LogtrailModule, RelasiModule],
  controllers: [TradoController],
  providers: [TradoService],
  exports: [TradoService],
})
export class TradoModule {}
