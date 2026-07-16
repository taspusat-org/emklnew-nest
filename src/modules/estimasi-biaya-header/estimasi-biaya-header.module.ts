import { Module } from '@nestjs/common';
import { EstimasiBiayaHeaderService } from './estimasi-biaya-header.service';
import { EstimasiBiayaHeaderController } from './estimasi-biaya-header.controller';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { GlobalModule } from '../global/global.module';
import { LocksModule } from '../locks/locks.module';
import { UtilsModule } from 'src/utils/utils.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { EstimasiBiayaDetailBiayaModule } from '../estimasi-biaya-detail-biaya/estimasi-biaya-detail-biaya.module';
import { EstimasiBiayaDetailInvoiceModule } from '../estimasi-biaya-detail-invoice/estimasi-biaya-detail-invoice.module';

@Module({
  controllers: [EstimasiBiayaHeaderController],
  providers: [EstimasiBiayaHeaderService],
  imports: [
    JwtModule,
    AuthModule,
    GlobalModule,
    LocksModule,
    UtilsModule,
    RunningNumberModule,
    LogtrailModule,
    EstimasiBiayaDetailBiayaModule,
    EstimasiBiayaDetailInvoiceModule,
  ],
})
export class EstimasiBiayaHeaderModule {}
