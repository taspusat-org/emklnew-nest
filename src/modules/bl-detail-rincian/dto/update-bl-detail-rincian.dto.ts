import { PartialType } from '@nestjs/mapped-types';
import { CreateBlDetailRincianDto } from './create-bl-detail-rincian.dto';

export class UpdateBlDetailRincianDto extends PartialType(
  CreateBlDetailRincianDto,
) {}
