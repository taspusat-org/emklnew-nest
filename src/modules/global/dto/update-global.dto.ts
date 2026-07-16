import { PartialType } from '@nestjs/mapped-types';
import { CreateGlobalDto } from './create-global.dto';

export class UpdateGlobalDto extends PartialType(CreateGlobalDto) {}
