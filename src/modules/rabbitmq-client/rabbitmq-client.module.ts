import { Module } from '@nestjs/common';
import { RabbitmqClientService } from './rabbitmq-client.service';
import { RabbitmqClientController } from './rabbitmq-client.controller';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';

@Module({
  controllers: [RabbitmqClientController],
  providers: [RabbitmqClientService],
  imports: [RabbitmqModule],
})
export class RabbitmqClientModule {}
