import { Module } from '@nestjs/common';
import { PenerimaandetailService } from './penerimaandetail.service';
import { PenerimaandetailController } from './penerimaandetail.controller';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { UtilsModule } from 'src/utils/utils.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [UtilsModule, LogtrailModule, AuthModule],
  controllers: [PenerimaandetailController],
  providers: [PenerimaandetailService],
  exports: [PenerimaandetailService],
})
export class PenerimaandetailModule {}
