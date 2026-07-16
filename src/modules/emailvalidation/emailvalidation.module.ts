import { Module } from '@nestjs/common';
import { EmailvalidationService } from './emailvalidation.service';
import { EmailValidationController } from './emailvalidation.controller';

import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  controllers: [EmailValidationController],
  providers: [EmailvalidationService],
})
export class EmailvalidationModule {}
