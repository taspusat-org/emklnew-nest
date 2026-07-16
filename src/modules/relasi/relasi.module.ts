import { Module } from '@nestjs/common';
import { RelasiService } from './relasi.service';
import { RelasiController } from './relasi.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
@Module({
  imports: [
    UtilsModule,
    RedisModule,
    AuthModule,
    LogtrailModule,
    RunningNumberModule,
  ],
  controllers: [RelasiController],
  providers: [RelasiService],
  exports: [RelasiService],
})
export class RelasiModule {}
