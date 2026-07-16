import { Module } from '@nestjs/common';
import { PackinglistdetailrincianService } from './packinglistdetailrincian.service';
import { PackinglistdetailrincianController } from './packinglistdetailrincian.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  imports: [UtilsModule, LogtrailModule],
  controllers: [PackinglistdetailrincianController],
  providers: [PackinglistdetailrincianService],
  exports: [PackinglistdetailrincianService],
})
export class PackinglistdetailrincianModule {}
