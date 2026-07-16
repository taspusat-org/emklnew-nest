import { Injectable } from '@nestjs/common';
import { Client, ClientProxy, Transport } from '@nestjs/microservices';

@Injectable()
export class RabbitmqService {
  @Client({
    transport: Transport.RMQ,
    options: {
      urls: ['amqp://admin:123456@54.151.162.192:5672'], // URL RabbitMQ
      queue: 'hr_queue_dev', // RabbitMQ queue name
      queueOptions: {
        durable: true, // Queue durability untuk persistensi
      },
    },
  })
  client: ClientProxy;
}
