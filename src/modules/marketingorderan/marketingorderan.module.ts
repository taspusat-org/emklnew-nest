import { Module } from '@nestjs/common';
import { MarketingorderanService } from './marketingorderan.service';
import { MarketingorderanController } from './marketingorderan.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  controllers: [MarketingorderanController],
  providers: [MarketingorderanService],
  imports: [UtilsModule, LogtrailModule],
  exports: [MarketingorderanService],
})
export class MarketingorderanModule {}
