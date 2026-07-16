import { PartialType } from '@nestjs/mapped-types';
import { CreatePenerimaanemklheaderDto } from './create-penerimaanemklheader.dto';

export class UpdatePenerimaanemklheaderDto extends PartialType(
  CreatePenerimaanemklheaderDto,
) {}
