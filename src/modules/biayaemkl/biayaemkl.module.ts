import { Module } from '@nestjs/common';
import { BiayaemklService } from './biayaemkl.service';
import { BiayaemklController } from './biayaemkl.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  imports: [UtilsModule, RedisModule, AuthModule, LogtrailModule],
  controllers: [BiayaemklController],
  providers: [BiayaemklService],
  exports: [BiayaemklService],
})
export class BiayaemklModule {}
