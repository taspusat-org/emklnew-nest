import { Module } from '@nestjs/common';
import { PelayaranService } from './pelayaran.service';
import { PelayaranController } from './pelayaran.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { AuthModule } from '../auth/auth.module';
import { RelasiModule } from '../relasi/relasi.module';
import { ParameterModule } from '../parameter/parameter.module';
// import { GlobalModule } from '../global/global.module';
import { LocksModule } from '../locks/locks.module';

@Module({
  imports: [
    RedisModule,
    UtilsModule,
    AuthModule,
    LogtrailModule,
    RelasiModule,
    ParameterModule,
    // GlobalModule,
    LocksModule,
  ],
  controllers: [PelayaranController],
  providers: [PelayaranService],
  exports: [PelayaranService],
})
export class PelayaranModule {}
