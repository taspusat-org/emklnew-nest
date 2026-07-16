import { Module } from '@nestjs/common';
import { RabbitmqService } from './rabbitmq.service';
import { RabbitmqController } from './rabbitmq.controller';
import { UserModule } from '../user/user.module';

@Module({
  controllers: [RabbitmqController],
  providers: [RabbitmqService],
  exports: [RabbitmqService],
  imports: [UserModule],
})
export class RabbitmqModule {}
