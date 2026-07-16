import { PartialType } from '@nestjs/swagger';
import { CreateTesmoduleDto } from './create-tesmodule.dto';

export class UpdateTesmoduleDto extends PartialType(CreateTesmoduleDto) {}
