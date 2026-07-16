import { PartialType } from '@nestjs/mapped-types';
import { CreateJurnalumumheaderDto } from './create-jurnalumumheader.dto';

export class UpdateJurnalumumheaderDto extends PartialType(
  CreateJurnalumumheaderDto,
) {}
