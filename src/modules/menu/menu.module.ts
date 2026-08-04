import { Module } from '@nestjs/common';
import { MenuService } from './menu.service';
import { MenuController } from './menu.controller';
import { UtilsModule } from 'src/utils/utils.module';
import { RedisModule } from 'src/common/redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { LogtrailModule } from 'src/common/logtrail/logtrail.module';
import { MenuResequenceController } from './menu-resequence.controller';
import { ReportModule } from 'src/common/report/report.module';

@Module({
  imports: [
    UtilsModule,
    RedisModule,
    AuthModule,
    LogtrailModule,
    // Menyediakan ExportJobService (export Excel background + socket progres).
    ReportModule,
  ],
  controllers: [MenuController, MenuResequenceController],
  providers: [MenuService],
})
export class MenuModule {}
