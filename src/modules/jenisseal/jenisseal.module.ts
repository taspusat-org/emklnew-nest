import { Module } from '@nestjs/common';
import { JenissealService } from './jenisseal.service';
import { JenissealController } from './jenisseal.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { LocksModule } from '../locks/locks.module';
import { GlobalModule } from '../global/global.module';

@Module({
  imports: [
    UtilsModule,
    RedisModule,
    AuthModule,
    LogtrailModule,
    GlobalModule,
    LocksModule,
  ],
  controllers: [JenissealController],
  providers: [JenissealService],
})
export class JenissealModule {}
