import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { requestContext } from '../context/request-context';
import { ReportJobStore } from './report-job.store';
import { ReportGateway } from './report.gateway';

/** Batas keras format xlsx: 1.048.576 baris per sheet (termasuk header). */
export const EXCEL_MAX_ROWS = 1_048_576;

/** Progres di-emit tiap sekian baris ATAU sekian ms, mana yang lebih dulu. */
const PROGRESS_ROW_INTERVAL = 5_000;
const PROGRESS_TIME_INTERVAL_MS = 400;

/**
 * Lebar kolom pada xlsx ditulis di elemen `<cols>`, yang HARUS berada sebelum
 * `<sheetData>`. Pada mode streaming ExcelJS menulis `<cols>` tepat saat baris
 * pertama di-flush, jadi lebar kolom hanya bisa diukur dari baris yang sudah
 * dilihat sebelum itu. Karena itu sejumlah baris pertama ditahan dulu di memori
 * untuk diukur, baru sisanya mengalir seperti biasa. Jumlahnya sengaja kecil
 * supaya pemakaian memori tetap datar walau datanya jutaan baris.
 */
const WIDTH_SAMPLE_ROWS = 500;

/** Batas lebar kolom hasil auto-fit (satuan ≈ jumlah karakter). */
const MIN_COLUMN_WIDTH = 6;
const MAX_COLUMN_WIDTH = 60;

/** Kelonggaran supaya teks tidak menempel ke garis border sel. */
const COLUMN_WIDTH_PADDING = 2;

/**
 * Label tahap yang tampil di toast. Sengaja hanya menyebut tahapannya, tanpa
 * angka baris — hitungan detailnya sudah terwakili oleh progress bar.
 */
const STEP = {
  counting: 'Menghitung jumlah data...',
  querying: 'Mengambil data...',
  writing: 'Menulis data ke Excel...',
  finalizing: 'Menyelesaikan file...',
  done: 'Excel siap diunduh.',
} as const;

export interface ExportSheetDefinition {
  sheetName?: string;
  /** Baris judul di atas header (di-merge selebar kolom header). */
  titleLines?: string[];
  headers: string[];
  /**
   * Lebar kolom tetap. Boleh dikosongkan seluruhnya, atau per kolom (`null` /
   * `undefined`) — kolom yang tidak diisi lebarnya mengikuti isi data
   * (auto-fit). Isi hanya bila memang ingin menguncinya di angka tertentu.
   */
  columnWidths?: (number | null | undefined)[];
  /** Memetakan satu baris database menjadi nilai-nilai sel. */
  mapRow: (row: any, rowNumber: number) => (string | number | null)[];
}

export interface StartExportJobOptions {
  /** Nama file yang dipakai saat diunduh browser. */
  filename: string;
  /** Jumlah baris yang akan diekspor — dipakai untuk progres yang sebenarnya. */
  countRows: () => Promise<number>;
  /**
   * Sumber baris dalam bentuk stream (mis. knex `.stream()`), BUKAN array.
   * Export bisa menyentuh jutaan baris; menariknya sekaligus ke memori
   * membuat proses kehabisan heap.
   */
  streamRows: () => NodeJS.ReadableStream;
  sheet: ExportSheetDefinition;
}

/**
 * Menjalankan export Excel di background lalu melaporkan progresnya lewat
 * socket — pola & channel-nya sama persis dengan ReportJobService (namespace
 * `/report`, event `report:progress`, room = jobId), hanya berkas hasilnya
 * xlsx. Hasilnya diambil di GET /report/download/:jobId.
 *
 * Seluruh pipeline-nya streaming: baris ditarik dari database lewat cursor dan
 * langsung ditulis ke file xlsx sementara, jadi pemakaian memori tidak ikut
 * naik seiring jumlah baris. Sebelumnya seluruh hasil query ditampung di array
 * lalu dirakit di memori — pada ~1 juta baris itu menabrak heap limit V8.
 */
@Injectable()
export class ExportJobService {
  private readonly logger = new Logger(ExportJobService.name);

  constructor(
    private readonly jobStore: ReportJobStore,
    private readonly gateway: ReportGateway,
  ) {}

  /**
   * Mendaftarkan job baru dan langsung mengembalikan jobId — proses export
   * sengaja TIDAK di-await supaya request HTTP-nya balas seketika.
   */
  start(options: StartExportJobOptions): { jobId: string } {
    const jobId = randomUUID();

    this.jobStore.set(jobId, {
      status: 'processing',
      kind: 'excel',
      createdAt: new Date(),
    });

    requestContext.exit(() => {
      void this.run(jobId, options);
    });

    return { jobId };
  }

  /**
   * Ticker halus untuk tahap yang panjangnya tidak bisa diukur (query + sort
   * di database, yang belum mengeluarkan baris apa pun). Begitu baris pertama
   * mengalir, progres diambil alih perhitungan nyata baris tertulis / total.
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
      const increment = Math.max(0.2, remaining * 0.08);
      current = Math.min(current + increment, capPercent);
      this.gateway.emitProgress(jobId, {
        step,
        percent: Math.round(current),
        status: 'processing',
      });
    }, PROGRESS_TIME_INTERVAL_MS);
    ticker.unref?.();
    return ticker;
  }

  private failJob(jobId: string, step: string, error: string): void {
    this.jobStore.set(jobId, {
      status: 'error',
      kind: 'excel',
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

  /** File hasil ditulis ke <cwd>/tmp, lalu dihapus setelah diunduh / kadaluarsa. */
  private createTempPath(jobId: string): string {
    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    return path.resolve(tempDir, `export-${jobId}.xlsx`);
  }

  private async run(
    jobId: string,
    options: StartExportJobOptions,
  ): Promise<void> {
    const startedAt = Date.now();
    const { sheet } = options;
    const headerOffset = (sheet.titleLines?.length ?? 0) + 2; // judul + 1 baris kosong + header

    // ── Tahap 1: hitung jumlah baris (untuk progres yang nyata) ────────────
    this.gateway.emitProgress(jobId, {
      step: STEP.counting,
      percent: 2,
      status: 'processing',
    });

    let total: number;
    try {
      total = await options.countRows();
    } catch (err: any) {
      this.logger.error(
        `[run] count FAILED → jobId=${jobId}, error=${err.message}`,
        err.stack,
      );
      this.failJob(
        jobId,
        'Gagal menghitung data.',
        err.message ?? 'Unknown error',
      );
      return;
    }

    if (total === 0) {
      this.logger.warn(`[run] tidak ada data → jobId=${jobId}`);
      this.failJob(
        jobId,
        'Data tidak tersedia.',
        'Tidak ada data yang cocok dengan filter yang dipilih.',
      );
      return;
    }

    const maxDataRows = EXCEL_MAX_ROWS - headerOffset;
    if (total > maxDataRows) {
      this.logger.warn(
        `[run] baris melebihi batas xlsx → jobId=${jobId}, total=${total}`,
      );
      this.failJob(
        jobId,
        'Data terlalu banyak untuk satu file Excel.',
        `${total.toLocaleString('id-ID')} baris melebihi batas format xlsx ` +
          `(${maxDataRows.toLocaleString('id-ID')} baris). Persempit filter lalu coba lagi.`,
      );
      return;
    }

    // ── Tahap 2: jalankan query & tulis baris sambil streaming ─────────────
    // Database masih menyortir saat ini; belum ada baris yang keluar, jadi
    // dipakai ticker perkiraan dulu sampai baris pertama datang.
    this.gateway.emitProgress(jobId, {
      step: STEP.querying,
      percent: 5,
      status: 'processing',
    });
    let queryTicker: ReturnType<typeof setInterval> | null =
      this.startProgressTicker(jobId, STEP.querying, 5, 14);

    const filePath = this.createTempPath(jobId);
    let written = 0;

    try {
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
        // Shared strings menyimpan SEMUA string unik di memori sampai file
        // ditutup — justru yang ingin dihindari pada export besar.
        useSharedStrings: false,
      });

      const worksheet = workbook.addWorksheet(sheet.sheetName ?? 'Data Export');

      const rowStream = options.streamRows();
      let lastEmitAt = Date.now();
      let lastEmitRow = 0;

      // Header sengaja BELUM ditulis: lebar kolom baru bisa dihitung setelah
      // sebagian isi terlihat, dan setelah baris pertama di-flush lebarnya
      // tidak bisa diubah lagi.
      const widths = this.createWidthMeasurer(sheet);
      const pending: (string | number | null)[][] = [];
      let headerWritten = false;
      let flushed = 0;

      const flushPending = () => {
        if (!headerWritten) {
          this.writeHeader(worksheet, sheet, widths.result());
          headerWritten = true;
        }
        for (const values of pending) {
          flushed += 1;
          this.writeDataRow(worksheet, values, headerOffset + flushed);
        }
        pending.length = 0;
      };

      try {
        for await (const row of rowStream as AsyncIterable<any>) {
          if (queryTicker) {
            clearInterval(queryTicker);
            queryTicker = null;
          }

          written += 1;
          const values = sheet.mapRow(row, written);

          if (headerWritten) {
            flushed += 1;
            this.writeDataRow(worksheet, values, headerOffset + flushed);
          } else {
            widths.add(values);
            pending.push(values);
            if (pending.length >= WIDTH_SAMPLE_ROWS) flushPending();
          }

          const now = Date.now();
          if (
            written - lastEmitRow >= PROGRESS_ROW_INTERVAL ||
            now - lastEmitAt >= PROGRESS_TIME_INTERVAL_MS
          ) {
            lastEmitRow = written;
            lastEmitAt = now;
            // Progres nyata: 15% saat baris pertama → 95% saat baris terakhir.
            const percent = 15 + Math.floor((written / total) * 80);
            this.gateway.emitProgress(jobId, {
              step: STEP.writing,
              percent: Math.min(percent, 95),
              status: 'processing',
            });
          }
        }
      } finally {
        if (queryTicker) clearInterval(queryTicker);
      }

      // Data lebih sedikit dari ukuran sample: header + sisa baris belum
      // sempat ditulis di dalam loop.
      flushPending();

      this.gateway.emitProgress(jobId, {
        step: STEP.finalizing,
        percent: 96,
        status: 'processing',
      });

      worksheet.commit();
      await workbook.commit();

      const size = fs.statSync(filePath).size;

      this.jobStore.set(jobId, {
        status: 'done',
        kind: 'excel',
        filePath,
        filename: options.filename,
        createdAt: new Date(),
      });

      this.logger.log(
        `[run] DONE → jobId=${jobId}, rows=${written}, size=${size} bytes, ` +
          `totalDuration=${Date.now() - startedAt}ms`,
      );

      this.gateway.emitProgress(jobId, {
        step: STEP.done,
        percent: 100,
        status: 'done',
        downloadUrl: `/report/download/${jobId}`,
      });
    } catch (err: any) {
      this.logger.error(
        `[run] export FAILED → jobId=${jobId}, rowsWritten=${written}, error=${err.message}`,
        err.stack,
      );
      // File setengah jadi tidak berguna — buang supaya tmp tidak menumpuk.
      fs.promises.unlink(filePath).catch(() => undefined);
      this.failJob(
        jobId,
        'Gagal membuat file Excel.',
        err?.response?.message ?? err.message ?? 'Unknown error',
      );
    }
  }

  /**
   * Mengukur lebar tiap kolom dari teks terpanjang yang pernah dilihat —
   * dimulai dari judul kolomnya sendiri, lalu ditambah baris data yang
   * di-sample. Baris judul laporan sengaja tidak ikut diukur karena sel-nya
   * di-merge selebar tabel; kalau ikut, kolom pertama jadi melar sendiri.
   */
  private createWidthMeasurer(sheet: ExportSheetDefinition) {
    const fixed = sheet.columnWidths ?? [];
    const longest = sheet.headers.map((header) => String(header ?? '').length);

    return {
      add(values: (string | number | null)[]): void {
        values.forEach((value, index) => {
          if (index >= longest.length) return;
          const text = value === null || value === undefined ? '' : String(value);
          // Sel multi-baris: yang menentukan lebar hanya penggal terpanjang.
          for (const line of text.split('\n')) {
            longest[index] = Math.max(longest[index], line.length);
          }
        });
      },
      result(): number[] {
        return longest.map((length, index) => {
          const override = fixed[index];
          if (typeof override === 'number') return override;
          return Math.min(
            MAX_COLUMN_WIDTH,
            Math.max(MIN_COLUMN_WIDTH, length + COLUMN_WIDTH_PADDING),
          );
        });
      },
    };
  }

  private writeHeader(
    worksheet: any,
    sheet: ExportSheetDefinition,
    columnWidths: number[],
  ): void {
    const columnCount = sheet.headers.length;
    const lastColumn = String.fromCharCode(64 + columnCount); // 7 kolom -> 'G'
    const titleLines = sheet.titleLines ?? [];

    // WAJIB sebelum baris mana pun di-commit. ExcelJS menulis elemen `<cols>`
    // sekali saja, tepat saat baris pertama di-flush ke stream — lebar yang
    // diset setelah itu tidak pernah sampai ke file.
    columnWidths.forEach((width, index) => {
      worksheet.getColumn(index + 1).width = width;
    });

    titleLines.forEach((line, index) => {
      const row = worksheet.getRow(index + 1);
      row.getCell(1).value = line;
      row.getCell(1).alignment = {
        horizontal: 'center',
        vertical: 'middle',
      };
      row.getCell(1).font = {
        name: 'Tahoma',
        size: index === 0 ? 14 : 10,
        bold: true,
      };
      worksheet.mergeCells(`A${index + 1}:${lastColumn}${index + 1}`);
      row.commit();
    });

    // Satu baris kosong pemisah judul dan header.
    worksheet.getRow(titleLines.length + 1).commit();

    const headerRow = worksheet.getRow(titleLines.length + 2);
    sheet.headers.forEach((header, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = header;
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFF00' },
      };
      cell.font = { bold: true, name: 'Tahoma', size: 10 };
      cell.alignment = {
        horizontal: index === 0 ? 'right' : 'center',
        vertical: 'middle',
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });
    headerRow.commit();
  }

  private writeDataRow(
    worksheet: any,
    values: (string | number | null)[],
    rowNumber: number,
  ): void {
    const row = worksheet.getRow(rowNumber);
    values.forEach((value, index) => {
      const cell = row.getCell(index + 1);
      cell.value = value ?? '';
      cell.font = { name: 'Tahoma', size: 10 };
      cell.alignment = {
        horizontal: index === 0 ? 'right' : 'left',
        vertical: 'middle',
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });
    row.commit();
  }
}
