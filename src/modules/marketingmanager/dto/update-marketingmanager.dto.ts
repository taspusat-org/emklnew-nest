import { PartialType } from '@nestjs/mapped-types';
import { CreateMarketingmanagerDto } from './create-marketingmanager.dto';

export class UpdateMarketingmanagerDto extends PartialType(
  CreateMarketingmanagerDto,
) {}
