import { Module } from '@nestjs/common';
import { UseraclService } from './useracl.service';
import { UseraclController } from './useracl.controller';
import { AuthModule } from '../auth/auth.module';
import { UtilsModule } from 'src/utils/utils.module';

@Module({
  imports: [AuthModule, UtilsModule],
  controllers: [UseraclController],
  providers: [UseraclService],
})
export class UseraclModule {}
