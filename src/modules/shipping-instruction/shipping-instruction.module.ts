import { Module } from '@nestjs/common';
import { ShippingInstructionService } from './shipping-instruction.service';
import { ShippingInstructionController } from './shipping-instruction.controller';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { LocksModule } from '../locks/locks.module';
import { UtilsModule } from 'src/utils/utils.module';
import { GlobalModule } from '../global/global.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { ShippingInstructionDetailModule } from '../shipping-instruction-detail/shipping-instruction-detail.module';
import { ShippingInstructionDetailRincianModule } from '../shipping-instruction-detail-rincian/shipping-instruction-detail-rincian.module';

@Module({
  controllers: [ShippingInstructionController],
  providers: [ShippingInstructionService],
  imports: [
    JwtModule,
    AuthModule,
    RedisModule,
    LocksModule,
    UtilsModule,
    GlobalModule,
    LogtrailModule,
    RunningNumberModule,
    ShippingInstructionDetailModule,
    ShippingInstructionDetailRincianModule,
  ],
})
export class ShippingInstructionModule {}
