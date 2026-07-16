import { Module } from '@nestjs/common';
import { BlDetailRincianBiayaService } from './bl-detail-rincian-biaya.service';
import { BlDetailRincianBiayaController } from './bl-detail-rincian-biaya.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  controllers: [BlDetailRincianBiayaController],
  providers: [BlDetailRincianBiayaService],
  imports: [UtilsModule, LogtrailModule],
  exports: [BlDetailRincianBiayaService],
})
export class BlDetailRincianBiayaModule {}
