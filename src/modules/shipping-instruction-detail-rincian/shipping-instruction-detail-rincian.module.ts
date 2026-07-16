import { Module } from '@nestjs/common';
import { ShippingInstructionDetailRincianService } from './shipping-instruction-detail-rincian.service';
import { ShippingInstructionDetailRincianController } from './shipping-instruction-detail-rincian.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';

@Module({
  controllers: [ShippingInstructionDetailRincianController],
  providers: [ShippingInstructionDetailRincianService],
  imports: [UtilsModule, LogtrailModule, RunningNumberModule],
  exports: [ShippingInstructionDetailRincianService],
})
export class ShippingInstructionDetailRincianModule {}
