import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';

export type ReportJobKind = 'pdf' | 'excel';

export const REPORT_JOB_MIME: Record<ReportJobKind, string> = {
  pdf: 'application/pdf',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export interface ReportJob {
  status: 'processing' | 'done' | 'error';
  /** Jenis berkas hasil job — menentukan Content-Type saat diunduh. */
  kind: ReportJobKind;
  /** Hasil kecil (PDF) disimpan di memori. */
  buffer?: Buffer;
  /**
   * Hasil besar (export Excel jutaan baris) disimpan sebagai file sementara
   * dan dikirim streaming — menahannya sebagai Buffer di memori persis yang
   * membuat proses kehabisan heap.
   */
  filePath?: string;
  filename?: string;
  error?: string;
  createdAt: Date;
}

/**
 * Penyimpanan sementara hasil render PDF / export Excel, di-key oleh jobId.
 *
 * Disengaja in-memory (bukan redis): metadata-nya kecil dan hanya relevan
 * untuk satu klien selama beberapa menit. Kalau nanti backend dijalankan
 * multi-instance di belakang load balancer, store ini harus dipindah ke
 * redis/disk bersama supaya request download tidak nyasar ke instance yang
 * tidak memegang hasilnya.
 */
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

  /** Menghapus job sekaligus file sementaranya (kalau ada). */
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
