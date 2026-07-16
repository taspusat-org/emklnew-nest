import { PartialType } from '@nestjs/mapped-types';
import { CreatePengeluaranemkldetailDto } from './create-pengeluaranemkldetail.dto';

export class UpdatePengeluaranemkldetailDto extends PartialType(
  CreatePengeluaranemkldetailDto,
) {}
