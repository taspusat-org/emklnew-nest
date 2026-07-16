import { PartialType } from '@nestjs/mapped-types';
import { CreateBiayaExtraMuatanDetailDto } from './create-biaya-extra-muatan-detail.dto';

export class UpdateBiayaExtraMuatanDetailDto extends PartialType(
  CreateBiayaExtraMuatanDetailDto,
) {}
