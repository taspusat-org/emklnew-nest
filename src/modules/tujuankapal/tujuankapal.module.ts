import { Module } from '@nestjs/common';
import { TujuankapalService } from './tujuankapal.service';
import { TujuankapalController } from './tujuankapal.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  imports: [UtilsModule, RedisModule, AuthModule, LogtrailModule],
  controllers: [TujuankapalController],
  providers: [TujuankapalService],
  exports: [TujuankapalService],
})
export class TujuankapalModule {}
