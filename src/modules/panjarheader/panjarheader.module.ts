import { Module } from '@nestjs/common';
import { PanjarheaderService } from './panjarheader.service';
import { PanjarheaderController } from './panjarheader.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { LocksModule } from 'src/modules/locks/locks.module';
import { GlobalModule } from 'src/modules/global/global.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from 'src/modules/running-number/running-number.module';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from 'src/modules/auth/auth.module';
import { PanjarmuatandetailModule } from 'src/modules/panjarmuatandetail/panjarmuatandetail.module';

@Module({
  controllers: [PanjarheaderController],
  providers: [PanjarheaderService],
  imports: [
    JwtModule,
    AuthModule,
    UtilsModule,
    RedisModule,
    LocksModule,
    GlobalModule,
    LogtrailModule,
    RunningNumberModule,
    PanjarmuatandetailModule,
  ],
})
export class PanjarheaderModule {}
