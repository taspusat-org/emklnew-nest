import { Module } from '@nestjs/common';
import { ValidatorFactoryService } from './validator-factory.service';
import { ValidatorFactoryController } from './validator-factory.controller';
import { PelayaranModule } from '../pelayaran/pelayaran.module';

@Module({
  imports: [PelayaranModule],
  controllers: [ValidatorFactoryController],
  providers: [ValidatorFactoryService],
  exports: [ValidatorFactoryService],
})
export class ValidatorFactoryModule {}
