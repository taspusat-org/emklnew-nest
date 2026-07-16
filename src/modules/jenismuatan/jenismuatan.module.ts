import { Module } from '@nestjs/common';
import { JenisMuatanController } from './jenismuatan.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { AuthModule } from '../auth/auth.module';
import { RelasiModule } from '../relasi/relasi.module';
import { JenisMuatanService } from './jenismuatan.service';

@Module({
  imports: [RedisModule, UtilsModule, AuthModule, LogtrailModule, RelasiModule],
  controllers: [JenisMuatanController],
  providers: [JenisMuatanService],
  exports: [JenisMuatanService],
})
export class JenisMuatanModule {}
