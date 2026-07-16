import { forwardRef, Module } from '@nestjs/common';
import { PengeluaranemklheaderService } from './pengeluaranemklheader.service';
import { PengeluaranemklheaderController } from './pengeluaranemklheader.controller';
import { PengeluaranemkldetailModule } from '../pengeluaranemkldetail/pengeluaranemkldetail.module';
import { AuthModule } from '../auth/auth.module';
import { GlobalModule } from '../global/global.module';
import { LocksModule } from '../locks/locks.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { PengeluaranheaderModule } from '../pengeluaranheader/pengeluaranheader.module';
import { HutangheaderModule } from '../hutangheader/hutangheader.module';

@Module({
  imports: [
    PengeluaranemkldetailModule,
    UtilsModule,
    RedisModule,
    AuthModule,
    LogtrailModule,
    RunningNumberModule,
    GlobalModule,
    LocksModule,
    forwardRef(() => PengeluaranheaderModule),
    HutangheaderModule,
  ],
  controllers: [PengeluaranemklheaderController],
  providers: [PengeluaranemklheaderService],
  exports: [PengeluaranemklheaderService],
})
export class PengeluaranemklheaderModule {}
