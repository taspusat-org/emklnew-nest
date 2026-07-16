import { Module } from '@nestjs/common';
import { PenerimaanemkldetailService } from './penerimaanemkldetail.service';
import { PenerimaanemkldetailController } from './penerimaanemkldetail.controller';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { UtilsModule } from 'src/utils/utils.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [UtilsModule, AuthModule, LogtrailModule],
  controllers: [PenerimaanemkldetailController],
  providers: [PenerimaanemkldetailService],
  exports: [PenerimaanemkldetailService],
})
export class PenerimaanemkldetailModule {}
