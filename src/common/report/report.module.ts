import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { ReportGateway } from './report.gateway';
import { ReportJobStore } from './report-job.store';
import { ReportJobService } from './report-job.service';
import { ReportPdfService } from './report-pdf.service';

/**
 * Infrastruktur laporan background: satu job store, satu gateway socket, dan
 * satu renderer Stimulsoft yang dipakai bersama semua modul. Modul yang butuh
 * cetak PDF cukup meng-import module ini lalu memanggil ReportJobService.start
 * dengan loadData miliknya sendiri.
 */
@Module({
  controllers: [ReportController],
  providers: [
    ReportJobStore,
    ReportGateway,
    ReportPdfService,
    ReportJobService,
  ],
  exports: [ReportJobService, ReportGateway, ReportJobStore, ReportPdfService],
})
export class ReportModule {}
