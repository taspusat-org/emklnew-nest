import { Module } from '@nestjs/common';
import { JenisbiayamarketingService } from './jenisbiayamarketing.service';
import { JenisbiayamarketingController } from './jenisbiayamarketing.controller';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { GlobalModule } from '../global/global.module';
import { LocksModule } from '../locks/locks.module';

@Module({
  imports: [
    AuthModule,
    RedisModule,
    UtilsModule,
    LogtrailModule,
    GlobalModule,
    LocksModule,
  ],
  controllers: [JenisbiayamarketingController],
  providers: [JenisbiayamarketingService],
})
export class JenisbiayamarketingModule {}
