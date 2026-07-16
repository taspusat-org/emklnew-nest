import { Module } from '@nestjs/common';
import { OrderanHeaderService } from './orderan-header.service';
import { OrderanHeaderController } from './orderan-header.controller';
import { AuthModule } from '../auth/auth.module';
import { JwtModule } from '@nestjs/jwt';
import { RedisModule } from 'src/common/redis/redis.module';
import { LocksModule } from '../locks/locks.module';
import { UtilsModule } from 'src/utils/utils.module';
import { GlobalModule } from '../global/global.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { StatuspendukungModule } from '../statuspendukung/statuspendukung.module';
import { StatusjobModule } from '../statusjob/statusjob.module';
import { OrderanMuatanService } from './orderan-muatan.service';

@Module({
  controllers: [OrderanHeaderController],
  providers: [OrderanHeaderService, OrderanMuatanService],
  imports: [
    JwtModule,
    AuthModule,
    RedisModule,
    LocksModule,
    UtilsModule,
    GlobalModule,
    LogtrailModule,
    RunningNumberModule,
    StatuspendukungModule,
    StatusjobModule,
  ],
  exports: [OrderanHeaderService],
})
export class OrderanHeaderModule {}
