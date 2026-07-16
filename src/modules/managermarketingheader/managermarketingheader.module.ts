import { Module } from '@nestjs/common';
import { ManagermarketingheaderService } from './managermarketingheader.service';
import { ManagermarketingheaderController } from './managermarketingheader.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { ManagermarketingdetailModule } from '../managermarketingdetail/managermarketingdetail.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    UtilsModule,
    RedisModule,
    LogtrailModule,
    AuthModule,
    ManagermarketingdetailModule,
  ],
  controllers: [ManagermarketingheaderController],
  providers: [ManagermarketingheaderService],
  exports: [ManagermarketingheaderService],
})
export class ManagermarketingheaderModule {}
