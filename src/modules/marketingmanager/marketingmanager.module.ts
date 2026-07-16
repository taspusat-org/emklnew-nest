import { Module } from '@nestjs/common';
import { MarketingmanagerService } from './marketingmanager.service';
import { MarketingmanagerController } from './marketingmanager.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  controllers: [MarketingmanagerController],
  providers: [MarketingmanagerService],
  imports: [UtilsModule, LogtrailModule],
  exports: [MarketingmanagerService],
})
export class MarketingmanagerModule {}
