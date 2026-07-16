import { Inject } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RedisService } from 'src/common/redis/redis.service';

@WebSocketGateway({
  namespace: 'update',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
  },
})
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(private readonly redis: RedisService) {}

  afterInit(server: Server) {}

  handleConnection(client: Socket) {}

  handleDisconnect(client: Socket) {}

  async isItemLocked(itemId: string): Promise<boolean> {
    const lockKey = `itemLock:${itemId}`;
    const lockStatus = await this.redis.get(lockKey);
    return lockStatus === 'locked';
  }

  @SubscribeMessage('lockItem')
  async handleLockItem(@MessageBody() itemId: string): Promise<void> {
    const isLocked = await this.isItemLocked(itemId);
    if (isLocked) {
      this.server.emit('itemLocked', {
        itemId,
        message: 'Item sudah terkunci oleh user lain, silakan coba lagi nanti.',
      });

      return;
    }

    this.server.emit('itemLocked', {
      itemId,
      message: 'Item sedang diperbarui oleh user lain',
    });

    const lockKey = `itemLock:${itemId}`;
    await this.redis.setLockItem(lockKey, 'locked', 300);
  }

  @SubscribeMessage('unlockItem')
  async handleUnlockItem(@MessageBody() itemId: string): Promise<void> {
    await this.redis.del(`itemLock:${itemId}`);

    this.server.emit('itemUnlocked', {
      itemId,
      message: 'Item telah selesai diperbarui',
    });
  }

  @SubscribeMessage('commitUpdate')
  async handleCommitUpdate(
    @MessageBody() { itemId }: { itemId: string },
  ): Promise<void> {
    this.server.emit('itemUpdateStatus', {
      itemId,
      message: 'Item telah diperbarui',
    });

    await this.handleUnlockItem(itemId);
  }
}
