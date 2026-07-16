import { Module } from '@nestjs/common';
import { LocksService } from './locks.service';
import { LocksController } from './locks.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
// import { RunningNumberModule } from '../running-number/running-number.module';
// import { KasgantungdetailModule } from '../kasgantungdetail/kasgantungdetail.module';
import { GlobalModule } from '../global/global.module';
@Module({
  imports: [
    UtilsModule,
    RedisModule,
    AuthModule,
    LogtrailModule,
    // RunningNumberModule,
    // KasgantungdetailModule,
    // GlobalModule,
  ],
  controllers: [LocksController],
  providers: [LocksService],
  exports: [LocksService],
})
export class LocksModule {}
