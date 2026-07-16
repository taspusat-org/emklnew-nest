import { Module } from '@nestjs/common';
import { DaftarblService } from './daftarbl.service';
import { DaftarblController } from './daftarbl.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  imports: [UtilsModule, RedisModule, AuthModule, LogtrailModule],
  controllers: [DaftarblController],
  providers: [DaftarblService],
  exports: [DaftarblService],
})
export class DaftarblModule {}
