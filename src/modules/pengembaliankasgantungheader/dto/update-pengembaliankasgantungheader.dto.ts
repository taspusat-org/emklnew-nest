import { PartialType } from '@nestjs/mapped-types';
import { CreatePengembaliankasgantungheaderDto } from './create-pengembaliankasgantungheader.dto';

export class UpdatePengembaliankasgantungheaderDto extends PartialType(
  CreatePengembaliankasgantungheaderDto,
) {}
