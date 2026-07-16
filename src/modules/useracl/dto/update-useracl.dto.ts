import { PartialType } from '@nestjs/mapped-types';
import { CreateUseraclDto } from './create-useracl.dto';

export class UpdateUseraclDto extends PartialType(CreateUseraclDto) {}
