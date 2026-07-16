import { Module } from '@nestjs/common';
import { BlDetailRincianService } from './bl-detail-rincian.service';
import { BlDetailRincianController } from './bl-detail-rincian.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { BlDetailRincianBiayaModule } from '../bl-detail-rincian-biaya/bl-detail-rincian-biaya.module';

@Module({
  controllers: [BlDetailRincianController],
  providers: [BlDetailRincianService],
  imports: [UtilsModule, LogtrailModule, BlDetailRincianBiayaModule],
  exports: [BlDetailRincianService],
})
export class BlDetailRincianModule {}
