import { Module } from '@nestjs/common';
import { ConsigneehargajualService } from './consigneehargajual.service';
import { ConsigneehargajualController } from './consigneehargajual.controller';
import { AuthModule } from '../auth/auth.module';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  imports: [AuthModule, UtilsModule, LogtrailModule],
  controllers: [ConsigneehargajualController],
  providers: [ConsigneehargajualService],
  exports: [ConsigneehargajualService],
})
export class ConsigneehargajualModule {}
