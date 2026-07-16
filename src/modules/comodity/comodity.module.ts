import { Module } from '@nestjs/common';
import { ComodityService } from './comodity.service';
import { ComodityController } from './comodity.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  imports: [RedisModule, UtilsModule, AuthModule, LogtrailModule],
  controllers: [ComodityController],
  providers: [ComodityService],
  exports: [ComodityService],
})
export class ComodityModule {}
