import { Module } from '@nestjs/common';
import { JenisOrderanController } from './jenisorderan.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { AuthModule } from '../auth/auth.module';
import { RelasiModule } from '../relasi/relasi.module';
import { JenisOrderanService } from './jenisorderan.service';

@Module({
  imports: [RedisModule, UtilsModule, AuthModule, LogtrailModule, RelasiModule],
  controllers: [JenisOrderanController],
  providers: [JenisOrderanService],
  exports: [JenisOrderanService],
})
export class JenisOrderanModule {}
