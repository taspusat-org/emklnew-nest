import { Module } from '@nestjs/common';
import { StatuspendukungService } from './statuspendukung.service';
import { StatuspendukungController } from './statuspendukung.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';

@Module({
  imports: [UtilsModule, LogtrailModule],
  controllers: [StatuspendukungController],
  providers: [StatuspendukungService],
  exports: [StatuspendukungService],
})
export class StatuspendukungModule {}
