import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { LocksModule } from '../locks/locks.module';
import { UtilsModule } from 'src/utils/utils.module';
import { GlobalModule } from '../global/global.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { LabaRugiKalkulasiService } from './laba-rugi-kalkulasi.service';
import { RunningNumberModule } from '../running-number/running-number.module';
import { LabaRugiKalkulasiController } from './laba-rugi-kalkulasi.controller';
import { JurnalumumheaderModule } from '../jurnalumumheader/jurnalumumheader.module';

@Module({
  controllers: [LabaRugiKalkulasiController],
  providers: [LabaRugiKalkulasiService],
  imports: [
    JwtModule,
    AuthModule,
    RedisModule,
    LocksModule,
    UtilsModule,
    GlobalModule,
    LogtrailModule,
  ],
})
export class LabaRugiKalkulasiModule {}
