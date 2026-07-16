import { Module } from '@nestjs/common';
import { BiayaService } from './biaya.service';
import { BiayaController } from './biaya.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  imports: [UtilsModule, RedisModule, AuthModule, LogtrailModule],
  controllers: [BiayaController],
  providers: [BiayaService],
  exports: [BiayaService],
})
export class BiayaModule {}
