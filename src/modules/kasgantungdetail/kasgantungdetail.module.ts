import { Module } from '@nestjs/common';
import { KasgantungdetailService } from './kasgantungdetail.service';
import { KasgantungdetailController } from './kasgantungdetail.controller';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { AuthModule } from '../auth/auth.module';
import { UtilsModule } from 'src/utils/utils.module';

@Module({
  imports: [UtilsModule, AuthModule, LogtrailModule],
  controllers: [KasgantungdetailController],
  providers: [KasgantungdetailService],
  exports: [KasgantungdetailService],
})
export class KasgantungdetailModule {}
