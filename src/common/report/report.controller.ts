import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ReportJobStore } from './report-job.store';

@Controller('report')
export class ReportController {
  private readonly logger = new Logger(ReportController.name);

  constructor(private readonly jobStore: ReportJobStore) {}

  /**
   * Unduh hasil render. Dipanggil client setelah menerima event socket
   * `report:progress` berstatus `done`.
   *
   * Sengaja tanpa AuthGuard: jobId adalah UUID acak yang hanya diketahui
   * pemanggil endpoint report, umurnya 10 menit, dan buffer-nya dibuang tepat
   * setelah diunduh.
   */
  @Get('download/:jobId')
  download(@Param('jobId') jobId: string, @Res() res: Response): void {
    const job = this.jobStore.get(jobId);

    if (!job) {
      throw new HttpException(
        'Job tidak ditemukan atau sudah expired.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (job.status === 'processing') {
      throw new HttpException('PDF masih diproses.', HttpStatus.ACCEPTED);
    }

    if (job.status === 'error') {
      throw new HttpException(
        job.error ?? 'Terjadi kesalahan saat membuat laporan.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${job.filename}"`,
      'Content-Length': job.buffer!.length,
    });

    res.status(HttpStatus.OK).send(job.buffer);

    this.logger.log(
      `[download] job ${jobId} terkirim (${job.buffer!.length} bytes)`,
    );
    this.jobStore.delete(jobId);
  }
}
