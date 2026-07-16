import { PartialType } from '@nestjs/mapped-types';
import { CreateMarketingdetailDto } from './create-marketingdetail.dto';

export class UpdateMarketingdetailDto extends PartialType(
  CreateMarketingdetailDto,
) {}
