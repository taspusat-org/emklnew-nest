import { PartialType } from '@nestjs/mapped-types';
import { CreateMarketingorderanDto } from './create-marketingorderan.dto';

export class UpdateMarketingorderanDto extends PartialType(
  CreateMarketingorderanDto,
) {}
