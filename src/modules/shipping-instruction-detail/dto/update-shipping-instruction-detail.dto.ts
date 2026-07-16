import { PartialType } from '@nestjs/mapped-types';
import { CreateShippingInstructionDetailDto } from './create-shipping-instruction-detail.dto';

export class UpdateShippingInstructionDetailDto extends PartialType(
  CreateShippingInstructionDetailDto,
) {}
