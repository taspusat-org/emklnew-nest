import { Module } from '@nestjs/common';
import { RoleaclService } from './roleacl.service';
import { RoleaclController } from './roleacl.controller';
import { AuthModule } from '../auth/auth.module';
import { UtilsModule } from 'src/utils/utils.module';

@Module({
  imports: [AuthModule, UtilsModule],
  controllers: [RoleaclController],
  providers: [RoleaclService],
})
export class RoleaclModule {}
