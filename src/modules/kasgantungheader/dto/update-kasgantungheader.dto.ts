import { PartialType } from '@nestjs/mapped-types';
import { CreateKasgantungheaderDto } from './create-kasgantungheader.dto';

export class UpdateKasgantungheaderDto extends PartialType(
  CreateKasgantungheaderDto,
) {}
