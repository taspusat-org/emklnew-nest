import { Readable } from 'stream';
import * as fs from 'fs';
import * as ExcelJS from 'exceljs';
import { ExportJobService } from './export-job.service';
import { ReportJobStore } from './report-job.store';

/**
 * Export Excel berjalan di background dan melapor lewat socket. Spec ini
 * memakai gateway palsu untuk menangkap event `report:progress`-nya, dan
 * sumber baris berupa Readable biasa — tanpa socket/DB sungguhan.
 */
function makeHarness() {
  const store = new ReportJobStore();
  const emitted: any[] = [];

  let settle: () => void;
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const gateway: any = {
    emitProgress: (jobId: string, payload: any) => {
      emitted.push({ jobId, ...payload });
      if (payload.status !== 'processing') settle();
    },
  };

  return {
    store,
    emitted,
    finished,
    service: new ExportJobService(store, gateway),
  };
}

const sheet = {
  sheetName: 'Data Export',
  titleLines: ['PT. TRANSPORINDO AGUNG SEJAHTERA', 'LAPORAN ALAT BAYAR', 'Data Export'],
  headers: ['NO.', 'NAMA'],
  columnWidths: [6, 30],
  mapRow: (row: any, rowNumber: number) => [rowNumber, row.nama],
};

// 3 baris judul + 1 baris kosong + 1 baris header.
const HEADER_ROWS = 5;

describe('ExportJobService', () => {
  jest.setTimeout(120_000);

  it('menulis seluruh baris ke file xlsx tanpa menahan hasilnya di memori', async () => {
    const rows = Array.from({ length: 6_000 }, (_, i) => ({
      nama: `ALAT-${i}`,
    }));
    const { service, store, emitted, finished } = makeHarness();

    const { jobId } = service.start({
      filename: 'laporan_alatbayar.xlsx',
      countRows: async () => rows.length,
      streamRows: () => Readable.from(rows),
      sheet,
    });

    // Request HTTP balas seketika: job masih processing saat start() kembali.
    expect(store.get(jobId)).toMatchObject({
      status: 'processing',
      kind: 'excel',
    });

    await finished;

    const job = store.get(jobId)!;
    expect(job.status).toBe('done');
    expect(job.filename).toBe('laporan_alatbayar.xlsx');
    // Hasil disimpan sebagai file, BUKAN buffer di memori.
    expect(job.filePath).toBeTruthy();
    expect(job.buffer).toBeUndefined();
    expect(fs.existsSync(job.filePath!)).toBe(true);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(job.filePath!);
    const worksheet = workbook.getWorksheet('Data Export')!;

    expect(worksheet.getRow(1).getCell(1).value).toBe(
      'PT. TRANSPORINDO AGUNG SEJAHTERA',
    );
    expect(worksheet.getRow(HEADER_ROWS).getCell(1).value).toBe('NO.');
    expect(worksheet.rowCount).toBe(HEADER_ROWS + rows.length);
    expect(worksheet.getRow(HEADER_ROWS + 1).getCell(2).value).toBe('ALAT-0');
    expect(worksheet.getRow(HEADER_ROWS + rows.length).getCell(2).value).toBe(
      'ALAT-5999',
    );

    // Event terakhir memberi tahu frontend ke mana file-nya diambil.
    expect(emitted[emitted.length - 1]).toMatchObject({
      jobId,
      status: 'done',
      percent: 100,
      downloadUrl: `/report/download/${jobId}`,
    });

    // Step yang tampil hanya nama tahapan — tanpa angka baris apa pun.
    const writeSteps = emitted.filter(
      (e) => e.step === 'Menulis data ke Excel...',
    );
    expect(writeSteps.length).toBeGreaterThan(0);
    expect(emitted.every((e) => !/\d/.test(e.step))).toBe(true);

    // Progres bukan angka karangan: persennya naik terus, tidak pernah mundur.
    const percents = emitted.map((e) => e.percent);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));

    // Bersihkan file sementara.
    store.delete(jobId);
  });

  it('menolak export yang melebihi batas baris xlsx tanpa menyentuh data', async () => {
    const { service, store, emitted, finished } = makeHarness();
    const streamRows = jest.fn();

    const { jobId } = service.start({
      filename: 'laporan_alatbayar.xlsx',
      countRows: async () => 2_000_000,
      streamRows: streamRows as any,
      sheet,
    });

    await finished;

    expect(streamRows).not.toHaveBeenCalled();
    expect(store.get(jobId)).toMatchObject({ status: 'error', kind: 'excel' });
    expect(emitted[emitted.length - 1]).toMatchObject({
      status: 'error',
      step: 'Data terlalu banyak untuk satu file Excel.',
    });
  });

  it('menandai job error bila tidak ada data', async () => {
    const { service, store, emitted, finished } = makeHarness();
    const streamRows = jest.fn();

    const { jobId } = service.start({
      filename: 'laporan_alatbayar.xlsx',
      countRows: async () => 0,
      streamRows: streamRows as any,
      sheet,
    });

    await finished;

    expect(streamRows).not.toHaveBeenCalled();
    expect(store.get(jobId)).toMatchObject({ status: 'error', kind: 'excel' });
    expect(emitted[emitted.length - 1]).toMatchObject({
      status: 'error',
      step: 'Data tidak tersedia.',
    });
  });

  it('menandai job error bila stream data gagal di tengah jalan', async () => {
    const { service, store, emitted, finished } = makeHarness();

    const { jobId } = service.start({
      filename: 'laporan_alatbayar.xlsx',
      countRows: async () => 10,
      streamRows: () =>
        Readable.from(
          (async function* () {
            yield { nama: 'ALAT-0' };
            throw new Error('koneksi database putus');
          })(),
        ),
      sheet,
    });

    await finished;

    expect(store.get(jobId)).toMatchObject({
      status: 'error',
      error: 'koneksi database putus',
    });
    expect(emitted[emitted.length - 1]).toMatchObject({
      status: 'error',
      step: 'Gagal membuat file Excel.',
    });
  });
});
