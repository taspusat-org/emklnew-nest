import { Module } from '@nestjs/common';
import { EmklService } from './emkl.service';
import { EmklController } from './emkl.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { ReportModule } from 'src/common/report/report.module';
import { RelasiModule } from '../relasi/relasi.module';
import { LocksModule } from '../locks/locks.module';
@Module({
  imports: [
    UtilsModule,
    RedisModule,
    RelasiModule,
    AuthModule,
    LogtrailModule,
    RunningNumberModule,
    LocksModule,
    ReportModule,
  ],
  controllers: [EmklController],
  providers: [EmklService],
  exports: [EmklService],
})
export class EmklModule {}
