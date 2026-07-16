import { Module } from '@nestjs/common';
import { PengembaliankasgantungdetailService } from './pengembaliankasgantungdetail.service';
import { PengembaliankasgantungdetailController } from './pengembaliankasgantungdetail.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  imports: [UtilsModule, AuthModule, LogtrailModule],
  controllers: [PengembaliankasgantungdetailController],
  providers: [PengembaliankasgantungdetailService],
  exports: [PengembaliankasgantungdetailService],
})
export class PengembaliankasgantungdetailModule {}
