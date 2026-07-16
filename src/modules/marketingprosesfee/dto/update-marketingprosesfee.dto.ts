import { PartialType } from '@nestjs/mapped-types';
import { CreateMarketingprosesfeeDto } from './create-marketingprosesfee.dto';

export class UpdateMarketingprosesfeeDto extends PartialType(
  CreateMarketingprosesfeeDto,
) {}
