import { PartialType } from '@nestjs/mapped-types';
import { CreateBlHeaderDto } from './create-bl-header.dto';

export class UpdateBlHeaderDto extends PartialType(CreateBlHeaderDto) {}
