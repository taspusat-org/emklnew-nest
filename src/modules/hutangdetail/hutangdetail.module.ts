import { Module } from '@nestjs/common';
import { HutangdetailService } from './hutangdetail.service';
import { HutangdetailController } from './hutangdetail.controller';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { AuthModule } from '../auth/auth.module';
import { UtilsModule } from 'src/utils/utils.module';

@Module({
  imports: [UtilsModule, AuthModule, LogtrailModule],
  controllers: [HutangdetailController],
  providers: [HutangdetailService],
  exports: [HutangdetailService],
})
export class HutangdetailModule {}
