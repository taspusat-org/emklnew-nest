import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { requestContext } from '../context/request-context';
import { ReportJobStore } from './report-job.store';
import { ReportGateway } from './report.gateway';

export const EXCEL_MAX_ROWS = 1_048_576;

const PROGRESS_ROW_INTERVAL = 5_000;
const PROGRESS_TIME_INTERVAL_MS = 400;

const WIDTH_SAMPLE_ROWS = 500;

const MIN_COLUMN_WIDTH = 6;
const MAX_COLUMN_WIDTH = 60;

const COLUMN_WIDTH_PADDING = 2;

const STEP = {
  counting: 'Menghitung jumlah data...',
  querying: 'Mengambil data...',
  writing: 'Menulis data ke Excel...',
  finalizing: 'Menyelesaikan file...',
  done: 'Excel siap diunduh.',
} as const;

export type ExportColumnAlign = 'left' | 'center' | 'right';

export const EXCEL_FORMAT = {
  RUPIAH: '"Rp"#,##0;[Red]("Rp"#,##0)',
  RUPIAH_DESIMAL: '"Rp"#,##0.00;[Red]("Rp"#,##0.00)',
  ANGKA: '#,##0',
  ANGKA_DESIMAL: '#,##0.00',
  PERSEN: '0.00%',
  TANGGAL: 'dd-mm-yyyy',
  TANGGAL_JAM: 'dd-mm-yyyy hh:mm',
} as const;

export interface ExportColumnFormat {
  numFmt?: string;
  align?: ExportColumnAlign;
  headerAlign?: ExportColumnAlign;
  wrapText?: boolean;
}

export interface ExportInfoLine {
  label: string;
  value: string | number | null;
}

export interface ExportSheetDefinition {
  sheetName?: string;
  titleLines?: string[];
  infoLines?: ExportInfoLine[];
  totalRow?: { label?: string; sumColumns: number[] };
  headers: string[];
  columnWidths?: (number | null | undefined)[];
  columnFormats?: (ExportColumnFormat | null | undefined)[];
  mapRow: (row: any, rowNumber: number) => (string | number | null)[];
}

interface ResolvedColumnFormat {
  numFmt?: string;
  align: ExportColumnAlign;
  headerAlign: ExportColumnAlign;
  wrapText: boolean;
}

const DEFAULT_COLUMN_FORMAT: ResolvedColumnFormat = {
  align: 'left',
  headerAlign: 'center',
  wrapText: false,
};

function toNumericCell(
  value: string | number | null | undefined,
): string | number {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value;

  const trimmed = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return value;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : value;
}

function displayedLength(
  value: string | number | null | undefined,
  numFmt?: string,
): number {
  const text = value === null || value === undefined ? '' : String(value);
  // Sel multi-baris: yang menentukan lebar hanya penggal terpanjang.
  const plainLength = Math.max(
    ...text.split('\n').map((line) => line.length),
    0,
  );

  const numeric = typeof value === 'number' ? value : Number(text);
  if (!numFmt || text === '' || !Number.isFinite(numeric)) return plainLength;

  // Bagian sebelum ';' adalah format untuk angka positif; `[Red]` dsb hanya
  // instruksi warna, tidak ikut tampil.
  const pattern = numFmt.split(';')[0].replace(/\[[^\]]*\]/g, '');
  const quoted = [...pattern.matchAll(/"([^"]*)"/g)].reduce(
    (sum, match) => sum + match[1].length,
    0,
  );
  const literals = pattern
    .replace(/"[^"]*"/g, '')
    .replace(/[#0.,_*\\]/g, '').length;
  const decimals = /\.([#0]+)/.exec(pattern)?.[1].length ?? 0;
  const digits = Math.abs(Math.trunc(numeric)).toString().length;
  const grouped = /[#0],[#0]{3}/.test(pattern);

  return Math.max(
    plainLength,
    digits +
      (grouped ? Math.floor((digits - 1) / 3) : 0) +
      (decimals > 0 ? decimals + 1 : 0) +
      quoted +
      literals +
      (numeric < 0 ? 1 : 0),
  );
}

export interface StartExportJobOptions {
  filename: string;
  countRows: () => Promise<number>;
  streamRows: () => NodeJS.ReadableStream;
  sheet: ExportSheetDefinition;
}

@Injectable()
export class ExportJobService {
  private readonly logger = new Logger(ExportJobService.name);

  constructor(
    private readonly jobStore: ReportJobStore,
    private readonly gateway: ReportGateway,
  ) {}

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
    const headerOffset = this.resolveHeaderOffset(sheet);

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

    const maxDataRows =
      EXCEL_MAX_ROWS - headerOffset - (sheet.totalRow ? 1 : 0);
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
      // Format kolom dihitung sekali di luar loop — bagian ini dilewati
      // sekali per sel, jutaan kali pada export besar.
      const formats = this.resolveColumnFormats(sheet);
      const widths = this.createWidthMeasurer(sheet, formats);
      const pending: (string | number | null)[][] = [];
      const sumColumns = sheet.totalRow?.sumColumns ?? [];
      const totals = new Map<number, number>();
      let headerWritten = false;
      let flushed = 0;

      const flushPending = () => {
        if (!headerWritten) {
          this.writeHeader(worksheet, sheet, formats, widths.result());
          headerWritten = true;
        }
        for (const values of pending) {
          flushed += 1;
          this.writeDataRow(worksheet, formats, values, headerOffset + flushed);
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
          sumColumns.forEach((index) => {
            const numeric = toNumericCell(values[index]);
            if (typeof numeric === 'number') {
              totals.set(index, (totals.get(index) ?? 0) + numeric);
            }
          });

          if (headerWritten) {
            flushed += 1;
            this.writeDataRow(
              worksheet,
              formats,
              values,
              headerOffset + flushed,
            );
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

      if (sumColumns.length > 0) {
        this.writeTotalRow(
          worksheet,
          sheet,
          formats,
          totals,
          headerOffset + flushed + 1,
        );
      }

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

  private resolveHeaderOffset(sheet: ExportSheetDefinition): number {
    const titles = sheet.titleLines?.length ?? 0;
    const info = sheet.infoLines?.length ?? 0;
    return titles + 2 + (info > 0 ? info + 1 : 0);
  }

  private resolveColumnFormats(
    sheet: ExportSheetDefinition,
  ): ResolvedColumnFormat[] {
    const custom = sheet.columnFormats ?? [];

    return sheet.headers.map((_, index) => {
      const format = custom[index];
      const numeric = index === 0 || !!format?.numFmt;

      return {
        numFmt: format?.numFmt,
        align:
          format?.align ?? (numeric ? 'right' : DEFAULT_COLUMN_FORMAT.align),
        headerAlign:
          format?.headerAlign ??
          (index === 0 ? 'right' : DEFAULT_COLUMN_FORMAT.headerAlign),
        wrapText: format?.wrapText ?? DEFAULT_COLUMN_FORMAT.wrapText,
      };
    });
  }

  private createWidthMeasurer(
    sheet: ExportSheetDefinition,
    formats: ResolvedColumnFormat[],
  ) {
    const fixed = sheet.columnWidths ?? [];
    const longest = sheet.headers.map((header) => String(header ?? '').length);

    // Blok info ditulis di kolom 1 & 2, jadi ikut menentukan lebarnya —
    // tanpa ini label seperti "PENGELUARAN NO BUKTI" terpotong.
    (sheet.infoLines ?? []).forEach((info) => {
      longest[0] = Math.max(longest[0] ?? 0, String(info.label ?? '').length);
      if (longest.length > 1) {
        longest[1] = Math.max(longest[1] ?? 0, String(info.value ?? '').length);
      }
    });

    return {
      add(values: (string | number | null)[]): void {
        values.forEach((value, index) => {
          if (index >= longest.length) return;
          longest[index] = Math.max(
            longest[index],
            displayedLength(value, formats[index]?.numFmt),
          );
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
    formats: ResolvedColumnFormat[],
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

    // Satu baris kosong pemisah judul dan blok berikutnya.
    worksheet.getRow(titleLines.length + 1).commit();

    const infoLines = sheet.infoLines ?? [];
    infoLines.forEach((info, index) => {
      const row = worksheet.getRow(titleLines.length + 2 + index);
      const label = row.getCell(1);
      label.value = info.label;
      label.font = { name: 'Tahoma', size: 10, bold: true };
      label.alignment = { horizontal: 'left', vertical: 'middle' };

      const value = row.getCell(2);
      value.value = info.value ?? '';
      value.font = { name: 'Tahoma', size: 10 };
      value.alignment = { horizontal: 'left', vertical: 'middle' };
      row.commit();
    });

    if (infoLines.length > 0) {
      worksheet.getRow(titleLines.length + infoLines.length + 2).commit();
    }

    const headerRow = worksheet.getRow(this.resolveHeaderOffset(sheet));
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
        horizontal: formats[index]?.headerAlign ?? 'center',
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

  private writeTotalRow(
    worksheet: any,
    sheet: ExportSheetDefinition,
    formats: ResolvedColumnFormat[],
    totals: Map<number, number>,
    rowNumber: number,
  ): void {
    const border = {
      top: { style: 'thin' as const },
      left: { style: 'thin' as const },
      bottom: { style: 'thin' as const },
      right: { style: 'thin' as const },
    };
    const sumColumns = sheet.totalRow?.sumColumns ?? [];
    const firstSum = Math.min(...sumColumns);
    const row = worksheet.getRow(rowNumber);

    const label = row.getCell(1);
    label.value = sheet.totalRow?.label ?? 'TOTAL';
    label.font = { name: 'Tahoma', size: 10, bold: true };
    label.alignment = { horizontal: 'left', vertical: 'middle' };
    label.border = border;

    sumColumns.forEach((index) => {
      const cell = row.getCell(index + 1);
      cell.value = totals.get(index) ?? 0;
      if (formats[index]?.numFmt) cell.numFmt = formats[index].numFmt;
      cell.font = { name: 'Tahoma', size: 10, bold: true };
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
      cell.border = border;
    });

    // Merge WAJIB sebelum row.commit(): setelah baris di-flush ke stream,
    // ExcelJS tidak bisa lagi mengubahnya.
    if (firstSum > 1) {
      worksheet.mergeCells(rowNumber, 1, rowNumber, firstSum);
    }
    row.commit();
  }

  private writeDataRow(
    worksheet: any,
    formats: ResolvedColumnFormat[],
    values: (string | number | null)[],
    rowNumber: number,
  ): void {
    const row = worksheet.getRow(rowNumber);
    values.forEach((value, index) => {
      const format = formats[index] ?? DEFAULT_COLUMN_FORMAT;
      const cell = row.getCell(index + 1);
      // Konversi ke angka hanya untuk kolom yang memang diformat sebagai
      // angka — kolom teks seperti nomor bukti ('0012') harus tetap apa adanya.
      cell.value = format.numFmt ? toNumericCell(value) : (value ?? '');
      if (format.numFmt) cell.numFmt = format.numFmt;
      cell.font = { name: 'Tahoma', size: 10 };
      cell.alignment = {
        horizontal: format.align,
        vertical: 'middle',
        wrapText: format.wrapText,
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
