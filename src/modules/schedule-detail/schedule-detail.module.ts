import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { ScheduleDetailService } from './schedule-detail.service';
import { ScheduleDetailController } from './schedule-detail.controller';
import { ScheduleKapalModule } from '../schedule-kapal/schedule-kapal.module';

@Module({
  controllers: [ScheduleDetailController],
  providers: [ScheduleDetailService],
  exports: [ScheduleDetailService],
  imports: [AuthModule, UtilsModule, LogtrailModule, ScheduleKapalModule],
})
export class ScheduleDetailModule {}
