import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { LocksModule } from '../locks/locks.module';
import { GlobalModule } from '../global/global.module';
import { ReportModule } from 'src/common/report/report.module';
import { IdempotencyModule } from 'src/common/idempotency/idempotency.module';

@Module({
  imports: [
    UtilsModule,
    RedisModule,
    AuthModule,
    LogtrailModule,
    GlobalModule,
    LocksModule,
    ReportModule,
    IdempotencyModule,
  ],
  controllers: [UserController],
  exports: [UserService],
  providers: [UserService],
})
export class UserModule {}
