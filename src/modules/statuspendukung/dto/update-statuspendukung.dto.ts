import { PartialType } from '@nestjs/mapped-types';
import { CreateStatuspendukungDto } from './create-statuspendukung.dto';

export class UpdateStatuspendukungDto extends PartialType(
  CreateStatuspendukungDto,
) {}
