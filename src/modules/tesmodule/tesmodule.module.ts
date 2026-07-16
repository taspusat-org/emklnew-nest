import { Module } from '@nestjs/common';
import { TesmoduleService } from './tesmodule.service';
import { TesmoduleController } from './tesmodule.controller';

@Module({
  controllers: [TesmoduleController],
  providers: [TesmoduleService],
})
export class TesmoduleModule {}
