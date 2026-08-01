import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { requestContext } from '../context/request-context';
import { ReportJobStore } from './report-job.store';
import { ReportGateway } from './report.gateway';
import { ReportPdfService } from './report-pdf.service';

export interface StartReportJobOptions {
  /** Nama file template di folder "reports", mis. "LaporanGroupbiayaextra.mrt". */
  mrtName: string;
  /**
   * Pengambil data laporan. Dipanggil di background — modul pemanggil
   * biasanya membungkus findAll()-nya sendiri di sini, lalu memetakan
   * baris ke kolom yang dipakai template.
   */
  loadData: () => Promise<any[]>;
  /** Nama tabel di DataSet Stimulsoft. Default 'data' (dipakai template lama). */
  tableName?: string;
  /** Nama file PDF hasil unduhan. Default: mrtName dengan ekstensi .pdf. */
  filename?: string;
}

/**
 * Menjalankan render laporan di background lalu melaporkan progresnya lewat
 * socket — polanya mengikuti processJobFromQuery di service reportapi:
 * ambil data → render PDF → simpan buffer → emit `done` dengan downloadUrl.
 */
@Injectable()
export class ReportJobService {
  private readonly logger = new Logger(ReportJobService.name);

  constructor(
    private readonly jobStore: ReportJobStore,
    private readonly gateway: ReportGateway,
    private readonly reportPdf: ReportPdfService,
  ) {}

  /**
   * Mendaftarkan job baru dan langsung mengembalikan jobId — proses render
   * sengaja TIDAK di-await supaya request HTTP-nya balas seketika.
   */
  start(options: StartReportJobOptions): { jobId: string } {
    const jobId = randomUUID();
    const filename =
      options.filename ?? options.mrtName.replace(/\.mrt$/i, '.pdf');

    this.jobStore.set(jobId, { status: 'processing', createdAt: new Date() });

    // WAJIB dijalankan DI LUAR AsyncLocalStorage milik request HTTP.
    // Kalau tidak, job ini mewarisi `RequestStore` request yang sudah selesai;
    // begitu TimeoutInterceptor meng-abort store tersebut, listener di
    // wrapWithTimeout (common/utils/db.ts) me-rollback transaksi job yang
    // masih berjalan -> "Transaction query already complete".
    // Job background umurnya memang lebih panjang dari request pemicunya,
    // jadi ia tidak boleh terikat pada siklus hidup request.
    requestContext.exit(() => {
      void this.run(jobId, options, filename);
    });

    return { jobId };
  }

  /**
   * Ticker yang menaikkan percent secara halus mendekati cap tiap 400ms.
   * Durasi query maupun render tidak bisa diketahui di depan, jadi progres
   * yang ditampilkan adalah perkiraan yang selalu mendekat tapi tidak pernah
   * melewati cap — milestone aslinya yang menggeser angka ke tahap berikutnya.
   */
  private startProgressTicker(
    jobId: string,
    step: string,
    startPercent: number,
    capPercent: number,
  ): ReturnType<typeof setInterval> {
    let current = startPercent;
    const ticker = setInterval(() => {
      const remaining = capPercent - current;
      const increment = Math.max(0.5, remaining * 0.08);
      current = Math.min(current + increment, capPercent);
      this.gateway.emitProgress(jobId, {
        step,
        percent: Math.round(current),
        status: 'processing',
      });
    }, 400);
    ticker.unref?.();
    return ticker;
  }

  private failJob(jobId: string, step: string, error: string): void {
    this.jobStore.set(jobId, {
      status: 'error',
      error,
      createdAt: new Date(),
    });
    this.gateway.emitProgress(jobId, {
      step,
      percent: 100,
      status: 'error',
      error,
    });
  }

  private async run(
    jobId: string,
    options: StartReportJobOptions,
    filename: string,
  ): Promise<void> {
    const startedAt = Date.now();

    // ── Tahap 1: ambil data ────────────────────────────────────────────────
    this.gateway.emitProgress(jobId, {
      step: 'Mengambil data dari database...',
      percent: 5,
      status: 'processing',
    });

    const queryTicker = this.startProgressTicker(
      jobId,
      'Mengambil data dari database...',
      5,
      35,
    );

    let rows: any[];
    try {
      rows = await options.loadData();
      clearInterval(queryTicker);

      this.logger.log(
        `[run] query done → jobId=${jobId}, rows=${rows.length}, duration=${
          Date.now() - startedAt
        }ms`,
      );
    } catch (err: any) {
      clearInterval(queryTicker);
      this.logger.error(
        `[run] query FAILED → jobId=${jobId}, error=${err.message}`,
        err.stack,
      );
      this.failJob(
        jobId,
        'Gagal mengambil data dari database.',
        err.message ?? 'Unknown error',
      );
      return;
    }

    if (rows.length === 0) {
      this.logger.warn(`[run] tidak ada data → jobId=${jobId}`);
      this.failJob(
        jobId,
        'Data tidak tersedia.',
        'Tidak ada data yang cocok dengan filter yang dipilih.',
      );
      return;
    }

    // ── Tahap 2: render PDF ────────────────────────────────────────────────
    this.gateway.emitProgress(jobId, {
      step: 'Data diterima, memuat template laporan...',
      percent: 40,
      status: 'processing',
    });

    const pdfTicker = this.startProgressTicker(
      jobId,
      'Merender laporan...',
      40,
      93,
    );

    try {
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = await this.reportPdf.generatePdf(
          rows,
          options.mrtName,
          options.tableName,
        );
      } finally {
        clearInterval(pdfTicker);
      }

      this.jobStore.set(jobId, {
        status: 'done',
        buffer: pdfBuffer,
        filename,
        createdAt: new Date(),
      });

      this.logger.log(
        `[run] DONE → jobId=${jobId}, size=${pdfBuffer.length} bytes, totalDuration=${
          Date.now() - startedAt
        }ms`,
      );

      this.gateway.emitProgress(jobId, {
        step: 'PDF siap diunduh.',
        percent: 100,
        status: 'done',
        downloadUrl: `/report/download/${jobId}`,
      });
    } catch (err: any) {
      this.logger.error(
        `[run] generatePdf FAILED → jobId=${jobId}, error=${err.message}`,
        err.stack,
      );
      this.failJob(
        jobId,
        'Gagal generate PDF.',
        err?.response?.message ?? err.message ?? 'Unknown error',
      );
    }
  }
}
