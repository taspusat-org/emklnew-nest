import { Module } from '@nestjs/common';
import { UserroleService } from './userrole.service';
import { UserroleController } from './userrole.controller';
import { AuthModule } from '../auth/auth.module';
import { UtilsModule } from 'src/utils/utils.module';

@Module({
  imports: [AuthModule, UtilsModule],
  controllers: [UserroleController],
  providers: [UserroleService],
})
export class UserroleModule {}
