import { PartialType } from '@nestjs/mapped-types';
import { CreatePackinglistdetailrincianDto } from './create-packinglistdetailrincian.dto';

export class UpdatePackinglistdetailrincianDto extends PartialType(
  CreatePackinglistdetailrincianDto,
) {}
