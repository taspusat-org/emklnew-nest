import { PartialType } from '@nestjs/swagger';
import { CreateEstimasiBiayaDetailBiayaDto } from './create-estimasi-biaya-detail-biaya.dto';

export class UpdateEstimasiBiayaDetailBiayaDto extends PartialType(
  CreateEstimasiBiayaDetailBiayaDto,
) {}
