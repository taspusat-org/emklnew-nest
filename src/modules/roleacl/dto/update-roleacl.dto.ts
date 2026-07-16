import { PartialType } from '@nestjs/mapped-types';
import { CreateRoleaclDto } from './create-roleacl.dto';

export class UpdateRoleaclDto extends PartialType(CreateRoleaclDto) {}
