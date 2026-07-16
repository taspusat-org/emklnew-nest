import { forwardRef, Module } from '@nestjs/common';
import { PenerimaanemklheaderService } from './penerimaanemklheader.service';
import { PenerimaanemklheaderController } from './penerimaanemklheader.controller';
import { HutangheaderModule } from '../hutangheader/hutangheader.module';
import { PenerimaanemkldetailModule } from '../penerimaanemkldetail/penerimaanemkldetail.module';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { GlobalModule } from '../global/global.module';
import { LocksModule } from '../locks/locks.module';
import { PenerimaanheaderModule } from '../penerimaanheader/penerimaanheader.module';

@Module({
  imports: [
    PenerimaanemkldetailModule,
    UtilsModule,
    RedisModule,
    AuthModule,
    LogtrailModule,
    RunningNumberModule,
    GlobalModule,
    LocksModule,
    forwardRef(() => PenerimaanheaderModule),
    HutangheaderModule,
  ],
  controllers: [PenerimaanemklheaderController],
  providers: [PenerimaanemklheaderService],
  exports: [PenerimaanemklheaderService],
})
export class PenerimaanemklheaderModule {}
