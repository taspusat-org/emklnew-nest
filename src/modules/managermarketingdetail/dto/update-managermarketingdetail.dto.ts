import { PartialType } from '@nestjs/mapped-types';
import { CreateManagermarketingdetailDto } from './create-managermarketingdetail.dto';

export class UpdateManagermarketingdetailDto extends PartialType(
  CreateManagermarketingdetailDto,
) {}
