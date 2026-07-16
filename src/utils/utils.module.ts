import { Module } from '@nestjs/common';
import { UtilsService } from './utils.service';

@Module({
  providers: [UtilsService],
  exports: [UtilsService], // Export the service to use it in other modules
})
export class UtilsModule {}
