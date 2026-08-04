import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { ReportGateway } from './report.gateway';
import { ReportJobStore } from './report-job.store';
import { ReportJobService } from './report-job.service';
import { ExportJobService } from './export-job.service';
import { ReportPdfService } from './report-pdf.service';

/**
 * Infrastruktur laporan & export background: satu job store, satu gateway
 * socket, satu endpoint unduh, dan satu renderer Stimulsoft yang dipakai
 * bersama semua modul. Modul yang butuh cetak PDF cukup memanggil
 * ReportJobService.start, yang butuh export Excel memanggil
 * ExportJobService.start — keduanya dengan loadData miliknya sendiri.
 */
@Module({
  controllers: [ReportController],
  providers: [
    ReportJobStore,
    ReportGateway,
    ReportPdfService,
    ReportJobService,
    ExportJobService,
  ],
  exports: [
    ReportJobService,
    ExportJobService,
    ReportGateway,
    ReportJobStore,
    ReportPdfService,
  ],
})
export class ReportModule {}
