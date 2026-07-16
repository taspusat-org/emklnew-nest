import { PartialType } from '@nestjs/mapped-types';
import { CreatePackinglistheaderDto } from './create-packinglistheader.dto';

export class UpdatePackinglistheaderDto extends PartialType(
  CreatePackinglistheaderDto,
) {}
