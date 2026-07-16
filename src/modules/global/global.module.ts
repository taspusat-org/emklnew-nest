import { Module } from '@nestjs/common';
import { GlobalService } from './global.service';
import { GlobalController } from './global.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { ValidatorFactoryModule } from '../validator-factory/validator-factory.module';

@Module({
  imports: [UtilsModule, ValidatorFactoryModule],
  controllers: [GlobalController],
  providers: [GlobalService],
  exports: [GlobalService],
})
export class GlobalModule {}
