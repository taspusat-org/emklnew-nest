import { Module } from '@nestjs/common';
import { CabangService } from './cabang.service';
import { CabangController } from './cabang.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  imports: [UtilsModule, RedisModule, AuthModule, LogtrailModule],
  controllers: [CabangController],
  providers: [CabangService],
})
export class CabangModule {}
