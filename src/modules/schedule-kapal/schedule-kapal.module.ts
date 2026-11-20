import { Module } from '@nestjs/common';
import { ScheduleKapalService } from './schedule-kapal.service';
import { ScheduleKapalController } from './schedule-kapal.controller';
import { AuthModule } from '../auth/auth.module';
import { UtilsModule } from 'src/utils/utils.module';
import { GlobalModule } from '../global/global.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  imports: [UtilsModule, RedisModule, AuthModule, LogtrailModule, GlobalModule],
  controllers: [ScheduleKapalController],
  providers: [ScheduleKapalService],
  exports: [ScheduleKapalService],
})
export class ScheduleKapalModule {}
