import { Module } from '@nestjs/common';
import { BlDetailService } from './bl-detail.service';
import { BlDetailController } from './bl-detail.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { BlDetailRincianModule } from '../bl-detail-rincian/bl-detail-rincian.module';

@Module({
  controllers: [BlDetailController],
  providers: [BlDetailService],
  imports: [UtilsModule, LogtrailModule, BlDetailRincianModule],
  exports: [BlDetailService],
})
export class BlDetailModule {}
