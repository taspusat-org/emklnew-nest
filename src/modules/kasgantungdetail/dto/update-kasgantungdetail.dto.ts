import { PartialType } from '@nestjs/mapped-types';
import { CreateKasgantungdetailDto } from './create-kasgantungdetail.dto';

export class UpdateKasgantungdetailDto extends PartialType(
  CreateKasgantungdetailDto,
) {}
