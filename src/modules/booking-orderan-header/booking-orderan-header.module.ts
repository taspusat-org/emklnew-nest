import { JwtModule } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocksModule } from '../locks/locks.module';
import { UtilsModule } from 'src/utils/utils.module';
import { GlobalModule } from '../global/global.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { BookingOrderanHeaderService } from './booking-orderan-header.service';
import { BookingOrderanHeaderController } from './booking-orderan-header.controller';
import { BookingOrderanMuatanService } from './bookingorderanmuatan.service';
import { StatuspendukungModule } from '../statuspendukung/statuspendukung.module';
import { OrderanHeaderModule } from '../orderan-header/orderan-header.module';

@Module({
  controllers: [BookingOrderanHeaderController],
  providers: [BookingOrderanHeaderService, BookingOrderanMuatanService],
  imports: [
    JwtModule,
    AuthModule,
    RedisModule,
    LocksModule,
    UtilsModule,
    GlobalModule,
    LogtrailModule,
    RunningNumberModule,
    StatuspendukungModule,
    OrderanHeaderModule,
  ],
})
export class BookingOrderanHeaderModule {}
