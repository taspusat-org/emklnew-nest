import { Module } from '@nestjs/common';
import { RedisModule } from 'src/common/redis/redis.module';
import { ErrorController } from './error.controller';
import { ErrorService } from './error.service';
import { UtilsModule } from 'src/utils/utils.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  imports: [RedisModule, UtilsModule, AuthModule, LogtrailModule],
  controllers: [ErrorController],
  providers: [ErrorService],
  exports: [ErrorService],
})
export class ErrorModule {}
