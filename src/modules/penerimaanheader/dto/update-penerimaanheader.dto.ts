import { PartialType } from '@nestjs/mapped-types';
import { CreatePenerimaanheaderDto } from './create-penerimaanheader.dto';

export class UpdatePenerimaanheaderDto extends PartialType(
  CreatePenerimaanheaderDto,
) {}
