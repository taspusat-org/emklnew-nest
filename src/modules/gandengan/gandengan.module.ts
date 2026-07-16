import { Module } from '@nestjs/common';
import { GandenganController } from './gandengan.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { AuthModule } from '../auth/auth.module';
import { RelasiModule } from '../relasi/relasi.module';
import { GandenganService } from './gandengan.service';

@Module({
  imports: [RedisModule, UtilsModule, AuthModule, LogtrailModule, RelasiModule],
  controllers: [GandenganController],
  providers: [GandenganService],
  exports: [GandenganService],
})
export class GandenganModule {}
