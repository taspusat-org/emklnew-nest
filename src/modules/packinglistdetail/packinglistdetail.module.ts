import { Module } from '@nestjs/common';
import { PackinglistdetailService } from './packinglistdetail.service';
import { PackinglistdetailController } from './packinglistdetail.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { PackinglistdetailrincianModule } from '../packinglistdetailrincian/packinglistdetailrincian.module';
@Module({
  imports: [UtilsModule, LogtrailModule, PackinglistdetailrincianModule],
  controllers: [PackinglistdetailController],
  providers: [PackinglistdetailService],
  exports: [PackinglistdetailService],
})
export class PackinglistdetailModule {}
