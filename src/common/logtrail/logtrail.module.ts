import { Module } from '@nestjs/common';
import { LogtrailService } from './logtrail.service';
import { LogtrailController } from './logtrail.controller';

@Module({
  controllers: [LogtrailController],
  providers: [LogtrailService],
  exports: [LogtrailService],
})
export class LogtrailModule {}
