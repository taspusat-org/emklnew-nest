import { PartialType } from '@nestjs/mapped-types';
import { CreateBlDetailRincianBiayaDto } from './create-bl-detail-rincian-biaya.dto';

export class UpdateBlDetailRincianBiayaDto extends PartialType(
  CreateBlDetailRincianBiayaDto,
) {}
