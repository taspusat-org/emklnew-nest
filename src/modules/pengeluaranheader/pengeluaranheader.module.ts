import { forwardRef, Module } from '@nestjs/common';
import { PengeluaranheaderService } from './pengeluaranheader.service';
import { PengeluaranheaderController } from './pengeluaranheader.controller';
import { PengeluarandetailModule } from '../pengeluarandetail/pengeluarandetail.module';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { GlobalModule } from '../global/global.module';
import { LocksModule } from '../locks/locks.module';
import { JurnalumumheaderModule } from '../jurnalumumheader/jurnalumumheader.module';
import { StatuspendukungModule } from '../statuspendukung/statuspendukung.module';
import { PengeluaranemklheaderModule } from '../pengeluaranemklheader/pengeluaranemklheader.module';
import { PenerimaanemklheaderModule } from '../penerimaanemklheader/penerimaanemklheader.module';

@Module({
  imports: [
    UtilsModule,
    RedisModule,
    AuthModule,
    LogtrailModule,
    RunningNumberModule,
    PengeluarandetailModule,
    JurnalumumheaderModule,
    GlobalModule,
    LocksModule,
    StatuspendukungModule,
    PenerimaanemklheaderModule,
    forwardRef(() => PengeluaranemklheaderModule),
  ],
  controllers: [PengeluaranheaderController],
  providers: [PengeluaranheaderService],
  exports: [PengeluaranheaderService],
})
export class PengeluaranheaderModule {}
