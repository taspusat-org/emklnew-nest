import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { RedisService } from './redis.service';

@Controller('redis')
export class RedisController {
  constructor(private readonly redisService: RedisService) {}

  @Post('set')
  async setData(
    @Body() body: { key: string; value: string; ttl?: number },
  ): Promise<string | null> {
    const { key, value, ttl = 3600 } = body;
    return await this.redisService.set(key, value, ttl);
  }

  @Get('get/:key')
  async getData(@Param('key') key: string): Promise<any> {
    // Menyesuaikan tipe untuk JSON
    const value = await this.redisService.get(key);

    if (value !== null) {
      // Convert value to JSON if it's a string and has a valid JSON format
      try {
        return JSON.parse(value); // Parse the value to JSON
      } catch (error) {
        return { error: 'Value is not a valid JSON' }; // Return error if it's not valid JSON
      }
    }
    return { error: 'Key not found' }; // Return error if key is not found
  }

  @Post('del')
  async deleteData(@Body() body: { key: string }): Promise<number> {
    return await this.redisService.del(body.key);
  }
}
