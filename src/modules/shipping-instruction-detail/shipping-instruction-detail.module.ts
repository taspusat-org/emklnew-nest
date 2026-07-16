import { Module } from '@nestjs/common';
import { ShippingInstructionDetailService } from './shipping-instruction-detail.service';
import { ShippingInstructionDetailController } from './shipping-instruction-detail.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { ShippingInstructionDetailRincianModule } from '../shipping-instruction-detail-rincian/shipping-instruction-detail-rincian.module';

@Module({
  controllers: [ShippingInstructionDetailController],
  providers: [ShippingInstructionDetailService],
  imports: [
    UtilsModule,
    LogtrailModule,
    RunningNumberModule,
    ShippingInstructionDetailRincianModule,
  ],
  exports: [ShippingInstructionDetailService],
})
export class ShippingInstructionDetailModule {}
