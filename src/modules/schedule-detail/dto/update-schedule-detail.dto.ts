import { PartialType } from '@nestjs/mapped-types';
import { CreateScheduleDetailDto } from './create-schedule-detail.dto';

export class UpdateScheduleDetailDto extends PartialType(
  CreateScheduleDetailDto,
) {}
