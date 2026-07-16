import { Module } from '@nestjs/common';
import { PengeluaranemkldetailService } from './pengeluaranemkldetail.service';
import { PengeluaranemkldetailController } from './pengeluaranemkldetail.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  imports: [UtilsModule, AuthModule, LogtrailModule],
  controllers: [PengeluaranemkldetailController],
  providers: [PengeluaranemkldetailService],
  exports: [PengeluaranemkldetailService],
})
export class PengeluaranemkldetailModule {}
