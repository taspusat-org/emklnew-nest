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
import * as fs from 'fs';
import { REPORT_JOB_MIME, ReportJobStore } from './report-job.store';

@Controller('report')
export class ReportController {
  private readonly logger = new Logger(ReportController.name);

  constructor(private readonly jobStore: ReportJobStore) {}

  /**
   * Unduh hasil render. Dipanggil client setelah menerima event socket
   * `report:progress` berstatus `done`.
   *
   * Sengaja tanpa AuthGuard: jobId adalah UUID acak yang hanya diketahui
   * pemanggil endpoint report, umurnya 10 menit, dan hasilnya dibuang tepat
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
      throw new HttpException('Berkas masih diproses.', HttpStatus.ACCEPTED);
    }

    if (job.status === 'error') {
      throw new HttpException(
        job.error ?? 'Terjadi kesalahan saat membuat laporan.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const headers: Record<string, string | number> = {
      // PDF (report) dan XLSX (export) memakai endpoint unduh yang sama, jadi
      // Content-Type diambil dari jenis job — bukan di-hardcode pdf.
      'Content-Type': REPORT_JOB_MIME[job.kind] ?? REPORT_JOB_MIME.pdf,
      'Content-Disposition': `attachment; filename="${job.filename}"`,
    };

    // Hasil besar disimpan sebagai file dan dikirim streaming supaya tidak
    // perlu memuat seluruh isinya ke memori hanya untuk mengirimnya.
    if (job.filePath) {
      if (!fs.existsSync(job.filePath)) {
        this.jobStore.delete(jobId);
        throw new HttpException(
          'Berkas hasil sudah tidak tersedia.',
          HttpStatus.NOT_FOUND,
        );
      }

      const { size } = fs.statSync(job.filePath);
      res.set({ ...headers, 'Content-Length': size });
      res.status(HttpStatus.OK);

      const stream = fs.createReadStream(job.filePath);
      stream.on('error', (err) => {
        this.logger.error(`[download] gagal membaca ${job.filePath}`, err);
        res.destroy(err);
      });
      // Hapus job + file setelah response benar-benar selesai terkirim.
      res.on('close', () => this.jobStore.delete(jobId));
      stream.pipe(res);

      this.logger.log(`[download] job ${jobId} dikirim streaming (${size} bytes)`);
      return;
    }

    res.set({ ...headers, 'Content-Length': job.buffer!.length });
    res.status(HttpStatus.OK).send(job.buffer);

    this.logger.log(
      `[download] job ${jobId} terkirim (${job.buffer!.length} bytes)`,
    );
    this.jobStore.delete(jobId);
  }
}
