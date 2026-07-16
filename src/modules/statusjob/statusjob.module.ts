import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UtilsModule } from 'src/utils/utils.module';
import { StatusjobService } from './statusjob.service';
import { StatusjobController } from './statusjob.controller';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { LocksModule } from '../locks/locks.module';

@Module({
  imports: [AuthModule, LocksModule, UtilsModule, LogtrailModule],
  controllers: [StatusjobController],
  providers: [StatusjobService],
  exports: [StatusjobService],
})
export class StatusjobModule {}
