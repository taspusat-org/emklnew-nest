import { PartialType } from '@nestjs/mapped-types';
import { CreateLogtrailDto } from './create-logtrail.dto';

export class UpdateLogtrailDto extends PartialType(CreateLogtrailDto) {}
