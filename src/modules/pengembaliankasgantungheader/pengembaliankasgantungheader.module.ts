import { Module } from '@nestjs/common';
import { PengembaliankasgantungheaderService } from './pengembaliankasgantungheader.service';
import { PengembaliankasgantungheaderController } from './pengembaliankasgantungheader.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { PengembaliankasgantungdetailModule } from '../pengembaliankasgantungdetail/pengembaliankasgantungdetail.module';
import { PenerimaanheaderModule } from '../penerimaanheader/penerimaanheader.module';
import { LocksModule } from '../locks/locks.module';
import { GlobalModule } from '../global/global.module';

@Module({
  imports: [
    UtilsModule,
    RedisModule,
    AuthModule,
    LogtrailModule,
    RunningNumberModule,
    PengembaliankasgantungdetailModule,
    PenerimaanheaderModule,
    LocksModule,
    GlobalModule,
  ],
  controllers: [PengembaliankasgantungheaderController],
  providers: [PengembaliankasgantungheaderService],
})
export class PengembaliankasgantungheaderModule {}
