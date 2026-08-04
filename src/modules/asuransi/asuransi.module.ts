import { Module } from '@nestjs/common';
import { AsuransiService } from './asuransi.service';
import { AsuransiController } from './asuransi.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { LocksModule } from '../locks/locks.module';
import { GlobalModule } from '../global/global.module';
import { ReportModule } from 'src/common/report/report.module';

@Module({
  imports: [
    UtilsModule,
    RedisModule,
    AuthModule,
    LogtrailModule,
    RunningNumberModule,
    GlobalModule,
    LocksModule,
    ReportModule,
  ],
  controllers: [AsuransiController],
  providers: [AsuransiService],
  exports: [AsuransiService],
})
export class AsuransiModule {}
