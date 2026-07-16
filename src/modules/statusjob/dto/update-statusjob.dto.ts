import { PartialType } from '@nestjs/mapped-types';
import { CreateStatusjobDto } from './create-statusjob.dto';

export class UpdateStatusjobDto extends PartialType(CreateStatusjobDto) {}
