import { Module } from '@nestjs/common';
import { PackinglistheaderService } from './packinglistheader.service';
import { PackinglistheaderController } from './packinglistheader.controller';
import { AuthModule } from '../auth/auth.module';
import { LocksModule } from '../locks/locks.module';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { GlobalModule } from '../global/global.module';
import { StatuspendukungModule } from '../statuspendukung/statuspendukung.module';
import { PackinglistdetailModule } from '../packinglistdetail/packinglistdetail.module';

@Module({
  imports: [
    AuthModule,
    UtilsModule,
    RedisModule,
    LogtrailModule,
    RunningNumberModule,
    GlobalModule,
    LocksModule,
    StatuspendukungModule,
    PackinglistdetailModule,
  ],
  controllers: [PackinglistheaderController],
  providers: [PackinglistheaderService],
  exports: [PackinglistheaderService],
})
export class PackinglistheaderModule {}
