import { Module } from '@nestjs/common';
import { BiayaMuatanDetailService } from './biaya-muatan-detail.service';
import { BiayaMuatanDetailController } from './biaya-muatan-detail.controller';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { UtilsModule } from 'src/utils/utils.module';

@Module({
  controllers: [BiayaMuatanDetailController],
  providers: [BiayaMuatanDetailService],
  exports: [BiayaMuatanDetailService],
  imports: [LogtrailModule, UtilsModule],
})
export class BiayaMuatanDetailModule {}
