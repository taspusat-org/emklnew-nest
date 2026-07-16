// src/chat/chat.module.ts

import { Module } from '@nestjs/common';
import { SocketGateway } from './socket.gateway';
import { RedisModule } from 'src/common/redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [SocketGateway],
  exports: [SocketGateway],
})
export class SocketModule {}
