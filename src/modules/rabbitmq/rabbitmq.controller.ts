import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { RabbitmqService } from './rabbitmq.service';
import { CreateRabbitmqDto } from './dto/create-rabbitmq.dto';
import { UpdateRabbitmqDto } from './dto/update-rabbitmq.dto';
import { EventPattern, MessagePattern } from '@nestjs/microservices';
import { UserService } from '../user/user.service';

@Controller('rabbitmq')
export class RabbitmqController {
  constructor(
    private readonly rabbitmqService: RabbitmqService,
    // private readonly configService: ConfigService, // Inject config service untuk akses environment
  ) {}
}
