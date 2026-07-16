import { PartialType } from '@nestjs/mapped-types';
import { CreateRabbitmqClientDto } from './create-rabbitmq-client.dto';

export class UpdateRabbitmqClientDto extends PartialType(
  CreateRabbitmqClientDto,
) {}
