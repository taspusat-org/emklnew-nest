import { PartialType } from '@nestjs/mapped-types';
import { CreatePenerimaandetailDto } from './create-penerimaandetail.dto';

export class UpdatePenerimaandetailDto extends PartialType(
  CreatePenerimaandetailDto,
) {}
