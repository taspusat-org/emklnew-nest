import { PartialType } from '@nestjs/mapped-types';
import { CreateHutangdetailDto } from './create-hutangdetail.dto';

export class UpdateHutangdetailDto extends PartialType(CreateHutangdetailDto) {}
