import { PartialType } from '@nestjs/mapped-types';
import { CreateOrderanHeaderDto } from './create-orderan-header.dto';

export class UpdateOrderanHeaderDto extends PartialType(
  CreateOrderanHeaderDto,
) {}
