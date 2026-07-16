import { Module } from '@nestjs/common';
import { BlHeaderService } from './bl-header.service';
import { BlHeaderController } from './bl-header.controller';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { LocksModule } from '../locks/locks.module';
import { UtilsModule } from 'src/utils/utils.module';
import { GlobalModule } from '../global/global.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { BlDetailModule } from '../bl-detail/bl-detail.module';
import { BlDetailRincianModule } from '../bl-detail-rincian/bl-detail-rincian.module';
import { BlDetailRincianBiayaModule } from '../bl-detail-rincian-biaya/bl-detail-rincian-biaya.module';

@Module({
  controllers: [BlHeaderController],
  providers: [BlHeaderService],
  imports: [
    JwtModule,
    AuthModule,
    RedisModule,
    LocksModule,
    UtilsModule,
    GlobalModule,
    LogtrailModule,
    RunningNumberModule,
    BlDetailModule,
    BlDetailRincianModule,
    BlDetailRincianBiayaModule,
  ],
})
export class BlHeaderModule {}
