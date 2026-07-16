import { Module } from '@nestjs/common';
import { ConsigneebiayaService } from './consigneebiaya.service';
import { ConsigneebiayaController } from './consigneebiaya.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ConsigneebiayaController],
  providers: [ConsigneebiayaService],
})
export class ConsigneebiayaModule {}
