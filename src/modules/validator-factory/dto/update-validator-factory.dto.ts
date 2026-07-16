import { PartialType } from '@nestjs/mapped-types';
import { CreateValidatorFactoryDto } from './create-validator-factory.dto';

export class UpdateValidatorFactoryDto extends PartialType(
  CreateValidatorFactoryDto,
) {}
