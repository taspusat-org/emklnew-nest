import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UtilsModule } from 'src/utils/utils.module';
import { GlobalModule } from '../global/global.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { TypeAkuntansiService } from './type-akuntansi.service';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { TypeAkuntansiController } from './type-akuntansi.controller';
import { LocksModule } from '../locks/locks.module';
import { ReportModule } from 'src/common/report/report.module';

@Module({
  imports: [
    RedisModule,
    UtilsModule,
    AuthModule,
    LogtrailModule,
    GlobalModule,
    LocksModule,
    ReportModule,
  ],
  controllers: [TypeAkuntansiController],
  providers: [TypeAkuntansiService],
  exports: [TypeAkuntansiService],
})
export class TypeAkuntansiModule {}
