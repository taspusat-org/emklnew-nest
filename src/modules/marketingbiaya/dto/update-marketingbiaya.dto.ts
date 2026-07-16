import { PartialType } from '@nestjs/mapped-types';
import { CreateMarketingbiayaDto } from './create-marketingbiaya.dto';

export class UpdateMarketingbiayaDto extends PartialType(
  CreateMarketingbiayaDto,
) {}
