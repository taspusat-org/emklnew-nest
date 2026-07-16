import { Module } from '@nestjs/common';
import { OffdaysService } from './offdays.service';
import { OffdaysController } from './offdays.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  imports: [UtilsModule, RedisModule, AuthModule, LogtrailModule],
  controllers: [OffdaysController],
  providers: [OffdaysService],
})
export class OffdaysModule {}
