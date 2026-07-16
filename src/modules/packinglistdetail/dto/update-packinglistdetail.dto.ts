import { PartialType } from '@nestjs/mapped-types';
import { CreatePackinglistdetailDto } from './create-packinglistdetail.dto';

export class UpdatePackinglistdetailDto extends PartialType(
  CreatePackinglistdetailDto,
) {}
