import { PartialType } from '@nestjs/mapped-types';
import { CreateConsigneeDto } from './create-consignee.dto';

export class UpdateConsigneeDto extends PartialType(CreateConsigneeDto) {}
