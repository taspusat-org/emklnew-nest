import { Module } from '@nestjs/common';
import { MarketingdetailService } from './marketingdetail.service';
import { MarketingdetailController } from './marketingdetail.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { AuthModule } from '../auth/auth.module';
import { LocksModule } from '../locks/locks.module';

@Module({
  controllers: [MarketingdetailController],
  providers: [MarketingdetailService],
  imports: [UtilsModule, LogtrailModule, AuthModule, LocksModule],
  exports: [MarketingdetailService],
})
export class MarketingdetailModule {}
