import { Injectable } from '@nestjs/common';
import { getPrinters, print } from 'pdf-to-printer';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

@Injectable()
export class PrinterService {
  // Mendapatkan daftar printer yang tersedia
  async getPrinters() {
    const printers = await getPrinters();
    return printers.map((p) => ({ name: p.name }));
  }

  // Fungsi untuk mencetak file
  async printFile(printerName: string, fileBuffer: Buffer): Promise<any> {
    // Validasi apakah printerName adalah string yang valid
    if (typeof printerName !== 'string' || !printerName.trim()) {
      throw new Error('Printer name must be a non-empty string');
    }

    if (!fileBuffer) {
      throw new Error('File data is required');
    }

    console.log('Selected printer name:', printerName);

    // Membuat path sementara untuk file yang akan dicetak
    const tempFilePath = path.join(tmpdir(), `print_job_${Date.now()}.pdf`);

    // Menyimpan buffer file sementara
    await fs.writeFile(tempFilePath, fileBuffer);
    try {
      // Melakukan pencetakan ke printer yang dipilih
      await print(tempFilePath, {
        printer: '\\\\192.168.3.21\\EPSON L3210 Series', // Menggunakan printerName yang dipilih
        paperSize: 'A4',
        orientation: 'landscape',
        scale: 'fit',
      });
      console.log(`Document successfully sent to printer: ${printerName}`);
      return {
        success: true,
        message: 'Document successfully sent to printer',
      };
    } catch (error) {
      console.error('Failed to send document to printer:', error);
      throw new Error('Failed to send document to printer.');
    } finally {
      // Membersihkan file sementara setelah pencetakan
      await fs.unlink(tempFilePath);
    }
  }
}
