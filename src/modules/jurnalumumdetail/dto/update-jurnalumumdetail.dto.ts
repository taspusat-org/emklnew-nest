import { PartialType } from '@nestjs/mapped-types';
import { CreateJurnalumumdetailDto } from './create-jurnalumumdetail.dto';

export class UpdateJurnalumumdetailDto extends PartialType(
  CreateJurnalumumdetailDto,
) {}
