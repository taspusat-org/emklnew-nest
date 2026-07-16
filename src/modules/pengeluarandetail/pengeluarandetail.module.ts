import { Module } from '@nestjs/common';
import { PengeluarandetailService } from './pengeluarandetail.service';
import { PengeluarandetailController } from './pengeluarandetail.controller';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { AuthModule } from '../auth/auth.module';
import { UtilsModule } from 'src/utils/utils.module';

@Module({
  imports: [UtilsModule, AuthModule, LogtrailModule],
  controllers: [PengeluarandetailController],
  providers: [PengeluarandetailService],
  exports: [PengeluarandetailService],
})
export class PengeluarandetailModule {}
