import { Module } from '@nestjs/common';
import { ScheduleKapalService } from './schedule-kapal.service';
import { ScheduleKapalController } from './schedule-kapal.controller';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { UtilsModule } from 'src/utils/utils.module';
import { GlobalModule } from '../global/global.module';
import { RedisModule } from 'src/common/redis/redis.module';

@Module({
  controllers: [ScheduleKapalController],
  providers: [ScheduleKapalService],
  imports: [LogtrailModule, UtilsModule, AuthModule, GlobalModule, RedisModule],
  exports: [ScheduleKapalService],
})
export class ScheduleKapalModule {}
