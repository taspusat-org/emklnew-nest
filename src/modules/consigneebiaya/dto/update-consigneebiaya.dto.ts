import { PartialType } from '@nestjs/mapped-types';
import { CreateConsigneebiayaDto } from './create-consigneebiaya.dto';

export class UpdateConsigneebiayaDto extends PartialType(
  CreateConsigneebiayaDto,
) {}
