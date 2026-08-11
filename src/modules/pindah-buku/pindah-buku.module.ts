import { JwtModule } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocksModule } from '../locks/locks.module';
import { UtilsModule } from 'src/utils/utils.module';
import { GlobalModule } from '../global/global.module';
import { PindahBukuService } from './pindah-buku.service';
import { RedisModule } from 'src/common/redis/redis.module';
import { PindahBukuController } from './pindah-buku.controller';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { JurnalumumheaderModule } from '../jurnalumumheader/jurnalumumheader.module';
import { ReportModule } from 'src/common/report/report.module';

@Module({
  controllers: [PindahBukuController],
  providers: [PindahBukuService],
  imports: [
    JwtModule,
    AuthModule,
    RedisModule,
    LocksModule,
    UtilsModule,
    GlobalModule,
    LogtrailModule,
    RunningNumberModule,
    JurnalumumheaderModule,
    ReportModule,
  ],
  exports: [PindahBukuService],
})
export class PindahBukuModule {}
