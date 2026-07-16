import { PartialType } from '@nestjs/mapped-types';
import { CreatePengeluarandetailDto } from './create-pengeluarandetail.dto';

export class UpdatePengeluarandetailDto extends PartialType(
  CreatePengeluarandetailDto,
) {}
