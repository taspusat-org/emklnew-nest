import { Module } from '@nestjs/common';
import { PanjarmuatandetailService } from './panjarmuatandetail.service';
import { PanjarmuatandetailController } from './panjarmuatandetail.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  controllers: [PanjarmuatandetailController],
  providers: [PanjarmuatandetailService],
  imports: [UtilsModule, LogtrailModule],
  exports: [PanjarmuatandetailService],
})
export class PanjarmuatandetailModule {}
