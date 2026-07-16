import { Module } from '@nestjs/common';
import { MarketingService } from './marketing.service';
import { MarketingController } from './marketing.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { MarketingorderanModule } from '../marketingorderan/marketingorderan.module';
import { MarketingbiayaModule } from '../marketingbiaya/marketingbiaya.module';
import { MarketingmanagerModule } from '../marketingmanager/marketingmanager.module';
import { MarketingprosesfeeModule } from '../marketingprosesfee/marketingprosesfee.module';
import { MarketingdetailModule } from '../marketingdetail/marketingdetail.module';
import { LocksModule } from '../locks/locks.module';

@Module({
  controllers: [MarketingController],
  providers: [MarketingService],
  imports: [
    UtilsModule,
    LogtrailModule,
    AuthModule,
    RedisModule,
    MarketingorderanModule,
    MarketingbiayaModule,
    MarketingmanagerModule,
    MarketingprosesfeeModule,
    MarketingdetailModule,
    LocksModule,
  ],
})
export class MarketingModule {}
