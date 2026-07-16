import { PartialType } from '@nestjs/mapped-types';
import { CreatePenerimaanemkldetailDto } from './create-penerimaanemkldetail.dto';

export class UpdatePenerimaanemkldetailDto extends PartialType(
  CreatePenerimaanemkldetailDto,
) {}
