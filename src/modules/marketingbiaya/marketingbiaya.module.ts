import { Module } from '@nestjs/common';
import { MarketingbiayaService } from './marketingbiaya.service';
import { MarketingbiayaController } from './marketingbiaya.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  controllers: [MarketingbiayaController],
  providers: [MarketingbiayaService],
  imports: [UtilsModule, LogtrailModule],
  exports: [MarketingbiayaService],
})
export class MarketingbiayaModule {}
