import { Module } from '@nestjs/common';
import { JenisprosesfeeService } from './jenisprosesfee.service';
import { JenisprosesfeeController } from './jenisprosesfee.controller';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { UtilsModule } from 'src/utils/utils.module';
import { GlobalModule } from '../global/global.module';
import { LocksModule } from '../locks/locks.module';
import { RedisModule } from 'src/common/redis/redis.module';

@Module({
  controllers: [JenisprosesfeeController],
  providers: [JenisprosesfeeService],
  imports: [
    AuthModule,
    UtilsModule,
    LocksModule,
    RedisModule,
    GlobalModule,
    LogtrailModule,
  ],
})
export class JenisprosesfeeModule {}
