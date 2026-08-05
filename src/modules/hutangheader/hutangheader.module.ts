import { Module } from '@nestjs/common';
import { HutangheaderService } from './hutangheader.service';
import { HutangheaderController } from './hutangheader.controller';
import { HutangdetailModule } from '../hutangdetail/hutangdetail.module';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { GlobalModule } from '../global/global.module';
import { LocksModule } from '../locks/locks.module';
import { JurnalumumheaderModule } from '../jurnalumumheader/jurnalumumheader.module';
import { StatuspendukungModule } from '../statuspendukung/statuspendukung.module';
import { ReportModule } from 'src/common/report/report.module';

@Module({
  imports: [
    UtilsModule,
    RedisModule,
    AuthModule,
    LogtrailModule,
    RunningNumberModule,
    HutangdetailModule,
    JurnalumumheaderModule,
    GlobalModule,
    LocksModule,
    StatuspendukungModule,
    ReportModule,
  ],
  // Catatan: GlobalModule & LocksModule dipertahankan di imports meski service
  // tidak lagi meng-inject GlobalService/LocksService — sama seperti
  // PengeluaranheaderModule — agar modul lain yang menumpang graf ini tidak
  // ikut berubah.
  controllers: [HutangheaderController],
  providers: [HutangheaderService],
  exports: [HutangheaderService],
})
export class HutangheaderModule {}
