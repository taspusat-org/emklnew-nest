import { PartialType } from '@nestjs/mapped-types';
import { CreateFieldlengthDto } from './create-fieldlength.dto';

export class UpdateFieldlengthDto extends PartialType(CreateFieldlengthDto) {}
