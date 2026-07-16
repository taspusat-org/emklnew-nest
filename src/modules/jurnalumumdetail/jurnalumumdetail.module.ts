import { Module } from '@nestjs/common';
import { JurnalumumdetailService } from './jurnalumumdetail.service';
import { JurnalumumdetailController } from './jurnalumumdetail.controller';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { AuthModule } from '../auth/auth.module';
import { UtilsModule } from 'src/utils/utils.module';

@Module({
  imports: [UtilsModule, AuthModule, LogtrailModule],
  controllers: [JurnalumumdetailController],
  providers: [JurnalumumdetailService],
  exports: [JurnalumumdetailService],
})
export class JurnalumumdetailModule {}
