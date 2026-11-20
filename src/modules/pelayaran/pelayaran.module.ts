import { Module } from '@nestjs/common';
import { PelayaranService } from './pelayaran.service';
import { PelayaranController } from './pelayaran.controller';
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
  controllers: [PelayaranController],
  providers: [PelayaranService],
  exports: [PelayaranService],
})
export class PelayaranModule {}
