import { Module } from '@nestjs/common';
import { DaftarBankController } from './daftarbank.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { AuthModule } from '../auth/auth.module';
import { RelasiModule } from '../relasi/relasi.module';
import { DaftarBankService } from './daftarbank.service';

@Module({
  imports: [RedisModule, UtilsModule, AuthModule, LogtrailModule, RelasiModule],
  controllers: [DaftarBankController],
  providers: [DaftarBankService],
  exports: [DaftarBankService],
})
export class DaftarBankModule {}
