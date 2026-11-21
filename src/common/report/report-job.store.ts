import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';

export type ReportJobKind = 'pdf' | 'excel';

export const REPORT_JOB_MIME: Record<ReportJobKind, string> = {
  pdf: 'application/pdf',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export interface ReportJob {
  status: 'processing' | 'done' | 'error';
  kind: ReportJobKind;
  buffer?: Buffer;
  filePath?: string;
  filename?: string;
  error?: string;
  createdAt: Date;
}

@Injectable()
export class ReportJobStore {
  private readonly logger = new Logger(ReportJobStore.name);
  private readonly store = new Map<string, ReportJob>();
  private readonly TTL_MS = 10 * 60 * 1000; // 10 menit

  set(jobId: string, job: ReportJob): void {
    this.store.set(jobId, job);

    // Auto-cleanup setelah TTL supaya hasil besar tidak menumpuk di memori
    // maupun di folder tmp.
    setTimeout(() => {
      this.delete(jobId);
    }, this.TTL_MS).unref?.();
  }

  get(jobId: string): ReportJob | undefined {
    return this.store.get(jobId);
  }

  delete(jobId: string): void {
    const job = this.store.get(jobId);
    this.store.delete(jobId);

    if (!job?.filePath) return;
    fs.promises.unlink(job.filePath).catch((err) => {
      // File mungkin sudah hilang (dihapus manual / tmp dibersihkan) — cukup
      // dicatat, bukan kondisi yang perlu menggagalkan apa pun.
      this.logger.debug(
        `[cleanup] gagal menghapus ${job.filePath}: ${err.message}`,
      );
    });
  }
}
