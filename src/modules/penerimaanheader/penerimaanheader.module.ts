import { forwardRef, Module } from '@nestjs/common';
import { PenerimaanheaderService } from './penerimaanheader.service';
import { PenerimaanheaderController } from './penerimaanheader.controller';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { PenerimaandetailModule } from '../penerimaandetail/penerimaandetail.module';
import { GlobalModule } from '../global/global.module';
import { UtilsModule } from 'src/utils/utils.module';
import { LocksModule } from '../locks/locks.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { JurnalumumheaderModule } from '../jurnalumumheader/jurnalumumheader.module';
import { PenerimaanemklheaderModule } from '../penerimaanemklheader/penerimaanemklheader.module';
import { PengeluaranemklheaderModule } from '../pengeluaranemklheader/pengeluaranemklheader.module';

@Module({
  imports: [
    UtilsModule,
    RedisModule,
    AuthModule,
    LogtrailModule,
    RunningNumberModule,
    PenerimaandetailModule,
    GlobalModule,
    LocksModule,
    JurnalumumheaderModule,
    forwardRef(() => PengeluaranemklheaderModule),
    forwardRef(() => PenerimaanemklheaderModule),
  ],
  controllers: [PenerimaanheaderController],
  providers: [PenerimaanheaderService],
  exports: [PenerimaanheaderService],
})
export class PenerimaanheaderModule {}
