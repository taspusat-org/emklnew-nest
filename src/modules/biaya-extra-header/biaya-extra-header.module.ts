import { Module } from '@nestjs/common';
import { BiayaExtraHeaderService } from './biaya-extra-header.service';
import { BiayaExtraHeaderController } from './biaya-extra-header.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { LocksModule } from '../locks/locks.module';
import { GlobalModule } from '../global/global.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { BiayaExtraMuatanDetailModule } from '../biaya-extra-muatan-detail/biaya-extra-muatan-detail.module';

@Module({
  controllers: [BiayaExtraHeaderController],
  providers: [BiayaExtraHeaderService],
  imports: [
    JwtModule,
    AuthModule,
    UtilsModule,
    RedisModule,
    LocksModule,
    GlobalModule,
    LogtrailModule,
    RunningNumberModule,
    BiayaExtraMuatanDetailModule,
  ],
})
export class BiayaExtraHeaderModule {}
