import { Module } from '@nestjs/common';
import { GandenganService } from './gandengan.service';
import { GandenganController } from './gandengan.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { ReportModule } from 'src/common/report/report.module';
@Module({
  imports: [
    UtilsModule,
    RedisModule,
    AuthModule,
    LogtrailModule,
    RunningNumberModule,
    // Menyediakan ExportJobService (export Excel background + socket progres).
    ReportModule,
  ],
  controllers: [GandenganController],
  providers: [GandenganService],
  exports: [GandenganService],
})
export class GandenganModule {}
