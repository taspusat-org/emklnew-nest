import { Module } from '@nestjs/common';
import { BiayaHeaderService } from './biaya-header.service';
import { BiayaHeaderController } from './biaya-header.controller';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { GlobalModule } from '../global/global.module';
import { LocksModule } from '../locks/locks.module';
import { UtilsModule } from 'src/utils/utils.module';
import { RunningNumberModule } from '../running-number/running-number.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { BiayaMuatanDetailModule } from '../biaya-muatan-detail/biaya-muatan-detail.module';

@Module({
  controllers: [BiayaHeaderController],
  providers: [BiayaHeaderService],
  imports: [
    JwtModule,
    AuthModule,
    GlobalModule,
    LocksModule,
    UtilsModule,
    RunningNumberModule,
    LogtrailModule,
    BiayaMuatanDetailModule,
  ],
})
export class BiayaHeaderModule {}
