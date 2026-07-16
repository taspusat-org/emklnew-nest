import { PartialType } from '@nestjs/swagger';
import { CreatePanjarmuatandetailDto } from './create-panjarmuatandetail.dto';

export class UpdatePanjarmuatandetailDto extends PartialType(
  CreatePanjarmuatandetailDto,
) {}
