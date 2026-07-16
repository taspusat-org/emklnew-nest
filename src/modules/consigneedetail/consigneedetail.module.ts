import { Module } from '@nestjs/common';
import { ConsigneedetailService } from './consigneedetail.service';
import { ConsigneedetailController } from './consigneedetail.controller';
import { AuthModule } from '../auth/auth.module';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  imports: [AuthModule, UtilsModule, LogtrailModule],
  controllers: [ConsigneedetailController],
  providers: [ConsigneedetailService],
  exports: [ConsigneedetailService],
})
export class ConsigneedetailModule {}
