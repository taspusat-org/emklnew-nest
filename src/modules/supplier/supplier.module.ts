import { Module } from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { SupplierController } from './supplier.controller';
import { RedisModule } from 'src/common/redis/redis.module';
import { UtilsModule } from 'src/utils/utils.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { GlobalModule } from '../global/global.module';
import { LocksModule } from '../locks/locks.module';
import { RelasiModule } from '../relasi/relasi.module';

@Module({
  controllers: [SupplierController],
  providers: [SupplierService],
  imports: [
    RedisModule,
    UtilsModule,
    AuthModule,
    LogtrailModule,
    GlobalModule,
    LocksModule,
    RelasiModule,
  ],
})
export class SupplierModule {}
