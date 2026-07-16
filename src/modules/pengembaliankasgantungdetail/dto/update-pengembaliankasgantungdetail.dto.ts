import { PartialType } from '@nestjs/mapped-types';
import { CreatePengembaliankasgantungdetailDto } from './create-pengembaliankasgantungdetail.dto';

export class UpdatePengembaliankasgantungdetailDto extends PartialType(
  CreatePengembaliankasgantungdetailDto,
) {}
