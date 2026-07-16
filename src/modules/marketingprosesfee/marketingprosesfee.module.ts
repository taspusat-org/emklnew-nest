import { Module } from '@nestjs/common';
import { MarketingprosesfeeService } from './marketingprosesfee.service';
import { MarketingprosesfeeController } from './marketingprosesfee.controller';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { UtilsModule } from 'src/utils/utils.module';

@Module({
  controllers: [MarketingprosesfeeController],
  providers: [MarketingprosesfeeService],
  imports: [LogtrailModule, UtilsModule],
  exports: [MarketingprosesfeeService],
})
export class MarketingprosesfeeModule {}
