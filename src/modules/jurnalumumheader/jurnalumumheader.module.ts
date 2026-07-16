import { Module } from '@nestjs/common';
import { JurnalumumheaderService } from './jurnalumumheader.service';
import { JurnalumumheaderController } from './jurnalumumheader.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { JurnalumumdetailModule } from '../jurnalumumdetail/jurnalumumdetail.module';
import { GlobalModule } from '../global/global.module';
import { LocksModule } from '../locks/locks.module';
import { StatuspendukungModule } from '../statuspendukung/statuspendukung.module';

@Module({
  imports: [
    UtilsModule,
    RedisModule,
    AuthModule,
    LogtrailModule,
    RunningNumberModule,
    JurnalumumdetailModule,
    GlobalModule,
    LocksModule,
    StatuspendukungModule,
  ],
  controllers: [JurnalumumheaderController],
  providers: [JurnalumumheaderService],
  exports: [JurnalumumheaderService],
})
export class JurnalumumheaderModule {}
