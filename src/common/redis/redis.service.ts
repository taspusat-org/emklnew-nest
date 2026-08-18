import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async set(
    key: string,
    value: string,
    ttl: number = 3600,
  ): Promise<string | null> {
    // Cache writes are best-effort: if Redis is down, don't fail the request.
    try {
      return await this.redis.set(key, value, 'EX', ttl);
    } catch {
      return null;
    }
  }

  async get(key: string): Promise<string | null> {
    // Treat any Redis failure as a cache miss so callers fall back to the DB.
    try {
      const value = await this.redis.get(key);
      if (value !== null) {
        await this.redis.del(key);
      }
      return value;
    } catch {
      return null;
    }
  }

  async del(key: string): Promise<number> {
    try {
      return await this.redis.del(key);
    } catch {
      return 0;
    }
  }

  async flushAll(): Promise<string> {
    return this.redis.flushall();
  }

  async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    try {
      do {
        const result = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = result[0];
        keys.push(...result[1]);
      } while (cursor !== '0');
    } catch {
      return [];
    }

    return keys;
  }

  async keys(pattern: string): Promise<string[]> {
    return this.redis.keys(pattern);
  }

  async delMultiple(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.redis.del(...keys);
  }

  async delPattern(pattern: string): Promise<number> {
    const keys = await this.scanKeys(pattern);
    if (keys.length === 0) return 0;
    return this.delMultiple(keys);
  }

  async setLockItem(
    key: string,
    value: string,
    ttl: number = 300,
  ): Promise<void> {
    await this.redis.set(key, value, 'EX', ttl);
  }

  async getLockItem(key: string): Promise<string | null> {
    const value = await this.redis.get(key);
    if (value !== null) {
      await this.redis.del(key);
    }
    return value;
  }

  async delLockItem(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key);
    return result === 1;
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    const result = await this.redis.expire(key, seconds);
    return result === 1;
  }

  async ttl(key: string): Promise<number> {
    return this.redis.ttl(key);
  }
}
