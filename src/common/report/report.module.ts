import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { ReportGateway } from './report.gateway';
import { ReportJobStore } from './report-job.store';
import { ReportJobService } from './report-job.service';
import { ExportJobService } from './export-job.service';
import { ReportPdfService } from './report-pdf.service';

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
