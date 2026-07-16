import { Module } from '@nestjs/common';
import { ConsigneeService } from './consignee.service';
import { ConsigneeController } from './consignee.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { StatuspendukungModule } from '../statuspendukung/statuspendukung.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { ConsigneehargajualModule } from '../consigneehargajual/consigneehargajual.module';
import { ConsigneedetailModule } from '../consigneedetail/consigneedetail.module';

@Module({
  imports: [
    UtilsModule,
    StatuspendukungModule,
    LogtrailModule,
    RedisModule,
    AuthModule,
    ConsigneehargajualModule,
    ConsigneedetailModule,
  ],
  controllers: [ConsigneeController],
  providers: [ConsigneeService],
})
export class ConsigneeModule {}
