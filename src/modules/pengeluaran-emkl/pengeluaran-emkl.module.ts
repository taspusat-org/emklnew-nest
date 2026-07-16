import { JwtModule } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocksModule } from '../locks/locks.module';
import { UtilsModule } from 'src/utils/utils.module';
import { GlobalModule } from '../global/global.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { PengeluaranEmklService } from './pengeluaran-emkl.service';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { PengeluaranEmklController } from './pengeluaran-emkl.controller';

@Module({
  controllers: [PengeluaranEmklController],
  providers: [PengeluaranEmklService],
  imports: [
    JwtModule,
    AuthModule,
    RedisModule,
    LocksModule,
    UtilsModule,
    GlobalModule,
    LogtrailModule,
  ],
})
export class PengeluaranEmklModule {}
