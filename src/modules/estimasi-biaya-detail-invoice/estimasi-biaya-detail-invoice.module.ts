import { Module } from '@nestjs/common';
import { EstimasiBiayaDetailInvoiceService } from './estimasi-biaya-detail-invoice.service';
import { EstimasiBiayaDetailInvoiceController } from './estimasi-biaya-detail-invoice.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  controllers: [EstimasiBiayaDetailInvoiceController],
  providers: [EstimasiBiayaDetailInvoiceService],
  exports: [EstimasiBiayaDetailInvoiceService],
  imports: [UtilsModule, LogtrailModule],
})
export class EstimasiBiayaDetailInvoiceModule {}
