import { PartialType } from '@nestjs/swagger';
import { CreateBiayaMuatanDetailDto } from './create-biaya-muatan-detail.dto';

export class UpdateBiayaMuatanDetailDto extends PartialType(
  CreateBiayaMuatanDetailDto,
) {}
