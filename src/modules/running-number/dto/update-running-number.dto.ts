import { PartialType } from '@nestjs/mapped-types';
import { CreateRunningNumberDto } from './create-running-number.dto';

export class UpdateRunningNumberDto extends PartialType(
  CreateRunningNumberDto,
) {}
