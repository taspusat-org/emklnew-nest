import { Module } from '@nestjs/common';
import { AkuntansiService } from './akuntansi.service';
import { AkuntansiController } from './akuntansi.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  imports: [UtilsModule, RedisModule, AuthModule, LogtrailModule],
  controllers: [AkuntansiController],
  providers: [AkuntansiService],
  exports: [AkuntansiService],
})
export class AkuntansiModule {}
