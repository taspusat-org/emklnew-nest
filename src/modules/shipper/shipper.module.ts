import { Module } from '@nestjs/common';
import { ShipperService } from './shipper.service';
import { ShipperController } from './shipper.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RelasiModule } from '../relasi/relasi.module';
import { StatuspendukungModule } from '../statuspendukung/statuspendukung.module';

@Module({
  imports: [
    UtilsModule,
    RedisModule,
    AuthModule,
    LogtrailModule,
    RelasiModule,
    StatuspendukungModule,
  ],
  controllers: [ShipperController],
  providers: [ShipperService],
})
export class ShipperModule {}
