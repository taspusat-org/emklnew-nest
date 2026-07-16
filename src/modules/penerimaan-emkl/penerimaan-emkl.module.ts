import { Module } from '@nestjs/common';
import { PenerimaanEmklService } from './penerimaan-emkl.service';
import { PenerimaanEmklController } from './penerimaan-emkl.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { LocksModule } from '../locks/locks.module';
import { GlobalModule } from '../global/global.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';

@Module({
  controllers: [PenerimaanEmklController],
  providers: [PenerimaanEmklService],
  imports: [
    JwtModule,
    RedisModule,
    LocksModule,
    UtilsModule,
    GlobalModule,
    LogtrailModule,
    AuthModule,
  ],
})
export class PenerimaanEmklModule {}
