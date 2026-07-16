import { Module } from '@nestjs/common';
import { FieldlengthService } from './fieldlength.service';
import { FieldlengthController } from './fieldlength.controller';

@Module({
  controllers: [FieldlengthController],
  providers: [FieldlengthService],
})
export class FieldlengthModule {}
