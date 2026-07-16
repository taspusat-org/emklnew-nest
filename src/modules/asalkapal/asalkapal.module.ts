import { Module } from '@nestjs/common';
import { AsalkapalService } from './asalkapal.service';
import { AsalkapalController } from './asalkapal.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  imports: [UtilsModule, RedisModule, AuthModule, LogtrailModule],
  controllers: [AsalkapalController],
  providers: [AsalkapalService],
  exports: [AsalkapalService],
})
export class AsalkapalModule {}
