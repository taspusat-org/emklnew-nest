import { PartialType } from '@nestjs/mapped-types';
import { CreateConsigneedetailDto } from './create-consigneedetail.dto';

export class UpdateConsigneedetailDto extends PartialType(
  CreateConsigneedetailDto,
) {}
