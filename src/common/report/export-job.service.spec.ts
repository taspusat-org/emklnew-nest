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
  mapRow: (row: any, rowNumber: number) => [rowNumber, row.nama],
};

/** Menjalankan satu export sampai selesai lalu membuka file hasilnya. */
async function runExport(sheetDef: any, rows: any[]) {
  const { service, store, finished } = makeHarness();
  const { jobId } = service.start({
    filename: 'laporan.xlsx',
    countRows: async () => rows.length,
    streamRows: () => Readable.from(rows),
    sheet: sheetDef,
  });

  await finished;

  const job = store.get(jobId)!;
  expect(job.status).toBe('done');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(job.filePath!);
  const worksheet = workbook.getWorksheet(sheetDef.sheetName)!;

  return { worksheet, cleanup: () => store.delete(jobId) };
}

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

  /**
   * Lebar kolom ditulis ExcelJS di elemen `<cols>` sebelum `<sheetData>`, dan
   * hanya sekali — saat baris pertama di-flush. Dulu lebarnya diset SETELAH
   * baris judul/header di-commit, jadi tidak pernah ikut tersimpan dan semua
   * kolom keluar dengan lebar bawaan Excel.
   */
  it('menyimpan lebar kolom mengikuti isi data terpanjang', async () => {
    const { worksheet, cleanup } = await runExport(sheet, [
      { nama: 'BCA' },
      { nama: 'TRANSFER BANK MANDIRI CABANG SURABAYA' },
      { nama: 'TUNAI' },
    ]);

    // Judul kolom 'NO.' hanya 3 huruf — dinaikkan ke batas minimum.
    expect(worksheet.getColumn(1).width).toBe(6);
    // 'TRANSFER BANK MANDIRI CABANG SURABAYA' = 37 huruf + padding 2.
    expect(worksheet.getColumn(2).width).toBe(39);

    cleanup();
  });

  it('memotong kolom yang isinya sangat panjang di batas maksimum', async () => {
    const { worksheet, cleanup } = await runExport(sheet, [
      { nama: 'X'.repeat(300) },
    ]);

    expect(worksheet.getColumn(2).width).toBe(60);

    cleanup();
  });

  it('mengukur lebar dari sample walau barisnya melebihi batas sample', async () => {
    const rows = Array.from({ length: 1_200 }, (_, i) => ({
      nama: i === 3 ? 'NAMA ALAT BAYAR YANG PANJANG' : `ALAT-${i}`,
    }));
    const { worksheet, cleanup } = await runExport(sheet, rows);

    // Semua baris tetap tertulis, bukan cuma yang di-sample.
    expect(worksheet.rowCount).toBe(HEADER_ROWS + rows.length);
    expect(worksheet.getRow(HEADER_ROWS + 1).getCell(2).value).toBe('ALAT-0');
    expect(worksheet.getRow(HEADER_ROWS + rows.length).getCell(2).value).toBe(
      'ALAT-1199',
    );
    expect(worksheet.getColumn(2).width).toBe(30);

    cleanup();
  });

  it('tetap menghormati lebar kolom yang ditetapkan manual', async () => {
    const { worksheet, cleanup } = await runExport(
      { ...sheet, columnWidths: [null, 45] },
      [{ nama: 'BCA' }],
    );

    // Kolom tanpa angka ikut auto-fit, kolom yang diisi dipakai apa adanya.
    expect(worksheet.getColumn(1).width).toBe(6);
    expect(worksheet.getColumn(2).width).toBe(45);

    cleanup();
  });

  /**
   * Baris TOTAL diisi rumus SUM, bukan angka mati, supaya totalnya ikut berubah
   * saat rincian disunting. Nilai cache-nya WAJIB ikut ditulis: tanpa itu Excel
   * menghitung ulang saat file dibuka lalu menanyakan "save?" waktu ditutup.
   */
  it('menulis baris TOTAL sebagai rumus SUM beserta nilai cache-nya', async () => {
    const buktiSheet = {
      sheetName: 'Kas Gantung',
      titleLines: ['PT. TRANSPORINDO AGUNG SEJAHTERA', 'LAPORAN KAS GANTUNG'],
      infoLines: [{ label: 'NO BUKTI', value: 'KG.001' }],
      headers: ['NO.', 'KETERANGAN', 'NOMINAL'],
      columnFormats: [null, null, { numFmt: '#,##0.00' }],
      totalRow: { sumColumns: [2] },
      mapRow: (row: any, rowNumber: number) => [
        rowNumber,
        row.keterangan,
        row.nominal,
      ],
    };

    const { worksheet, cleanup } = await runExport(buktiSheet, [
      { keterangan: 'BIAYA A', nominal: 1_500_000 },
      { keterangan: 'BIAYA B', nominal: '2500000.50' },
      { keterangan: 'BIAYA C', nominal: 1_000 },
    ]);

    // 2 judul + kosong + 1 info + kosong + header = baris data mulai di 7.
    const firstDataRow = 7;
    const totalRow = worksheet.getRow(firstDataRow + 3);

    expect(totalRow.getCell(1).value).toBe('TOTAL');
    expect(totalRow.getCell(3).value).toEqual({
      formula: 'SUM(C7:C9)',
      result: 4_001_000.5,
    });
    // Nominal yang datang sebagai string tetap ditulis sebagai angka, kalau
    // tidak SUM-nya melewatkan barisnya.
    expect(worksheet.getRow(firstDataRow + 1).getCell(3).value).toBe(
      2_500_000.5,
    );

    cleanup();
  });

  /**
   * Baris ditulis lewat dua jalur: yang di-sample untuk lebar kolom ditahan
   * dulu lalu di-flush, sisanya ditulis langsung di dalam loop. Rentang SUM
   * harus menutup kedua jalur itu, bukan cuma baris yang di-sample.
   */
  it('merentang rumus TOTAL sampai baris terakhir yang ditulis', async () => {
    const rows = Array.from({ length: 600 }, () => ({
      keterangan: 'BIAYA',
      nominal: 1_000,
    }));
    const { worksheet, cleanup } = await runExport(
      {
        sheetName: 'Data Export',
        titleLines: ['LAPORAN'],
        headers: ['NO.', 'KETERANGAN', 'NOMINAL'],
        columnFormats: [null, null, { numFmt: '#,##0' }],
        totalRow: { sumColumns: [2] },
        mapRow: (row: any, rowNumber: number) => [
          rowNumber,
          row.keterangan,
          row.nominal,
        ],
      },
      rows,
    );

    // 1 judul + kosong + header = baris data mulai di 4.
    const totalRow = worksheet.getRow(4 + rows.length);
    expect(totalRow.getCell(3).value).toEqual({
      formula: 'SUM(C4:C603)',
      result: 600_000,
    });

    cleanup();
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
