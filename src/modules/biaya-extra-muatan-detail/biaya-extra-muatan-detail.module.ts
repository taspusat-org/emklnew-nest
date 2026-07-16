import { Module } from '@nestjs/common';
import { BiayaExtraMuatanDetailService } from './biaya-extra-muatan-detail.service';
import { BiayaExtraMuatanDetailController } from './biaya-extra-muatan-detail.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  controllers: [BiayaExtraMuatanDetailController],
  providers: [BiayaExtraMuatanDetailService],
  imports: [UtilsModule, LogtrailModule],
  exports: [BiayaExtraMuatanDetailService],
})
export class BiayaExtraMuatanDetailModule {}
