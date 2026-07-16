import { Module } from '@nestjs/common';
import { ManagermarketingdetailService } from './managermarketingdetail.service';
import { ManagermarketingdetailController } from './managermarketingdetail.controller';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { AuthModule } from '../auth/auth.module';
import { UtilsModule } from 'src/utils/utils.module';
@Module({
  imports: [UtilsModule, AuthModule, LogtrailModule],
  controllers: [ManagermarketingdetailController],
  providers: [ManagermarketingdetailService],
  exports: [ManagermarketingdetailService, ManagermarketingdetailModule],
})
export class ManagermarketingdetailModule {}
