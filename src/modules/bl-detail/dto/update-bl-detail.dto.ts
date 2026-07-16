import { PartialType } from '@nestjs/mapped-types';
import { CreateBlDetailDto } from './create-bl-detail.dto';

export class UpdateBlDetailDto extends PartialType(CreateBlDetailDto) {}
