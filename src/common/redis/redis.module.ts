import { Module, Global } from '@nestjs/common';
import { RedisService } from './redis.service';
import { Redis } from 'ioredis';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisController } from './redis.controller';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [RedisController],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: async (configService: ConfigService) => {
        const redis = new Redis({
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          password: configService.get<string>('REDIS_PASSWORD', ''),
          db: configService.get<number>('REDIS_DB', 0),
          // Fail fast when Redis is unavailable instead of hanging every request
          // that touches the cache. Without this, commands are queued offline and
          // retried for ~30s while Redis is down, turning a cache miss into a
          // request timeout/500. With enableOfflineQueue=false, commands reject
          // immediately while disconnected so callers fall back to the DB.
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 5000,
          // Keep trying to reconnect in the background (capped) so caching resumes
          // automatically once Redis comes back up.
          retryStrategy: (times) => Math.min(times * 500, 5000),
        });

        // ioredis emits 'error' on every failed (re)connect attempt. Without a
        // listener these become noisy unhandled-error events. Log at most once
        // per 30s so a down Redis doesn't flood the console.
        let lastErrLogged = 0;
        redis.on('error', (err) => {
          const now = Date.now();
          if (now - lastErrLogged > 30000) {
            lastErrLogged = now;
            console.warn(
              `[Redis] unavailable, caching disabled until reconnect: ${err.message}`,
            );
          }
        });

        return redis;
      },
      inject: [ConfigService],
    },
    RedisService,
  ],
  exports: [RedisService, 'REDIS_CLIENT'],
})
export class RedisModule {}
