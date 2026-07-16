import { Module } from '@nestjs/common';
import { MasterbiayaService } from './masterbiaya.service';
import { MasterbiayaController } from './masterbiaya.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  imports: [UtilsModule, RedisModule, AuthModule, LogtrailModule],
  controllers: [MasterbiayaController],
  providers: [MasterbiayaService],
  exports: [MasterbiayaService],
})
export class MasterbiayaModule {}
