import { Module } from '@nestjs/common';
import { MarketinggroupService } from './marketinggroup.service';
import { MarketinggroupController } from './marketinggroup.controller';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { GlobalModule } from '../global/global.module';
import { LocksModule } from '../locks/locks.module';

@Module({
  imports: [
    AuthModule,
    RedisModule,
    UtilsModule,
    LogtrailModule,
    GlobalModule,
    LocksModule,
  ],
  controllers: [MarketinggroupController],
  providers: [MarketinggroupService],
})
export class MarketinggroupModule {}
