import { PartialType } from '@nestjs/mapped-types';
import { CreatePengeluaranemklheaderDto } from './create-pengeluaranemklheader.dto';

export class UpdatePengeluaranemklheaderDto extends PartialType(
  CreatePengeluaranemklheaderDto,
) {}
