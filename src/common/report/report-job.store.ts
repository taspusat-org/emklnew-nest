import { Injectable } from '@nestjs/common';

export interface ReportJob {
  status: 'processing' | 'done' | 'error';
  buffer?: Buffer;
  filename?: string;
  error?: string;
  createdAt: Date;
}

/**
 * Penyimpanan sementara hasil render PDF, di-key oleh jobId.
 *
 * Disengaja in-memory (bukan redis): buffer PDF bisa puluhan MB dan hanya
 * relevan untuk satu klien selama beberapa menit. Kalau nanti backend
 * dijalankan multi-instance di belakang load balancer, store ini harus
 * dipindah ke redis/disk supaya request download tidak nyasar ke instance
 * yang tidak memegang buffer-nya.
 */
@Injectable()
export class ReportJobStore {
  private readonly store = new Map<string, ReportJob>();
  private readonly TTL_MS = 10 * 60 * 1000; // 10 menit

  set(jobId: string, job: ReportJob): void {
    this.store.set(jobId, job);

    // Auto-cleanup setelah TTL supaya buffer besar tidak menumpuk di memori.
    setTimeout(() => {
      this.store.delete(jobId);
    }, this.TTL_MS).unref?.();
  }

  get(jobId: string): ReportJob | undefined {
    return this.store.get(jobId);
  }

  delete(jobId: string): void {
    this.store.delete(jobId);
  }
}
