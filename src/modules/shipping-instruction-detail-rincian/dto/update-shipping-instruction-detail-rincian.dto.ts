import { PartialType } from '@nestjs/mapped-types';
import { CreateShippingInstructionDetailRincianDto } from './create-shipping-instruction-detail-rincian.dto';

export class UpdateShippingInstructionDetailRincianDto extends PartialType(
  CreateShippingInstructionDetailRincianDto,
) {}
