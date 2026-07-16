import { PartialType } from '@nestjs/swagger';
import { CreateEstimasiBiayaDetailInvoiceDto } from './create-estimasi-biaya-detail-invoice.dto';

export class UpdateEstimasiBiayaDetailInvoiceDto extends PartialType(
  CreateEstimasiBiayaDetailInvoiceDto,
) {}
