import { PartialType } from '@nestjs/mapped-types';
import { CreateConsigneehargajualDto } from './create-consigneehargajual.dto';

export class UpdateConsigneehargajualDto extends PartialType(
  CreateConsigneehargajualDto,
) {}
