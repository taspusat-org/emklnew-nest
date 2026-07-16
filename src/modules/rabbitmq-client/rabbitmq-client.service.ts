import { Injectable } from '@nestjs/common';
import { CreateRabbitmqClientDto } from './dto/create-rabbitmq-client.dto';
import { UpdateRabbitmqClientDto } from './dto/update-rabbitmq-client.dto';
import { MessagePattern, Payload } from '@nestjs/microservices';

@Injectable()
export class RabbitmqClientService {
  create(createRabbitmqClientDto: CreateRabbitmqClientDto) {
    return 'This action adds a new rabbitmqClient';
  }

  findAll() {
    return `This action returns all rabbitmqClient`;
  }

  findOne(id: string) {
    return `This action returns a #${id} rabbitmqClient`;
  }

  update(id: string, updateRabbitmqClientDto: UpdateRabbitmqClientDto) {
    return `This action updates a #${id} rabbitmqClient`;
  }

  remove(id: string) {
    return `This action removes a #${id} rabbitmqClient`;
  }
}
