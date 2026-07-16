import { PartialType } from '@nestjs/swagger';
import { CreateEmailvalidationDto } from './create-emailvalidation.dto';

export class UpdateEmailvalidationDto extends PartialType(
  CreateEmailvalidationDto,
) {}
