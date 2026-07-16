import { PartialType } from '@nestjs/mapped-types';
import { CreatePengeluaranheaderDto } from './create-pengeluaranheader.dto';

export class UpdatePengeluaranheaderDto extends PartialType(
  CreatePengeluaranheaderDto,
) {}
