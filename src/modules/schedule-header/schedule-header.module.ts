import { Module } from '@nestjs/common';
import { ScheduleHeaderService } from './schedule-header.service';
import { ScheduleHeaderController } from './schedule-header.controller';
import { AuthModule } from '../auth/auth.module';
import { UtilsModule } from 'src/utils/utils.module';
import { GlobalModule } from '../global/global.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { ScheduleDetailModule } from '../schedule-detail/schedule-detail.module';
import { LocksModule } from '../locks/locks.module';

@Module({
  controllers: [ScheduleHeaderController],
  providers: [ScheduleHeaderService],
  imports: [
    AuthModule,
    UtilsModule,
    RedisModule,
    LocksModule,
    LogtrailModule,
    GlobalModule,
    RunningNumberModule,
    ScheduleDetailModule,
  ],
})
export class ScheduleHeaderModule {}
