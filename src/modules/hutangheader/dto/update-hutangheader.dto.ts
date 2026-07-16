import { PartialType } from '@nestjs/mapped-types';
import { CreateHutangheaderDto } from './create-hutangheader.dto';

export class UpdateHutangheaderDto extends PartialType(CreateHutangheaderDto) {}
