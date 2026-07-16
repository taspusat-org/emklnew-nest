import { Module } from '@nestjs/common';
import { EstimasiBiayaDetailBiayaService } from './estimasi-biaya-detail-biaya.service';
import { EstimasiBiayaDetailBiayaController } from './estimasi-biaya-detail-biaya.controller';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { UtilsModule } from 'src/utils/utils.module';

@Module({
  controllers: [EstimasiBiayaDetailBiayaController],
  providers: [EstimasiBiayaDetailBiayaService],
  imports: [LogtrailModule, UtilsModule],
  exports: [EstimasiBiayaDetailBiayaService],
})
export class EstimasiBiayaDetailBiayaModule {}
