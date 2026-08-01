import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import * as path from 'path';

const STIMULSOFT_LICENSE_KEY =
  '6vJhGtLLLz2GNviWmUTrhSqnOItdDwjBylQzQcAOiHksEid1Z5nN/hHQewjPL/4/AvyNDbkXgG4Am2U6dyA8Ksinqp' +
  '6agGqoHp+1KM7oJE6CKQoPaV4cFbxKeYmKyyqjF1F1hZPDg4RXFcnEaYAPj/QLdRHR5ScQUcgxpDkBVw8XpueaSFBs' +
  'JVQs/daqfpFiipF1qfM9mtX96dlxid+K/2bKp+e5f5hJ8s2CZvvZYXJAGoeRd6iZfota7blbsgoLTeY/sMtPR2yutv' +
  'gE9TafuTEhj0aszGipI9PgH+A/i5GfSPAQel9kPQaIQiLw4fNblFZTXvcrTUjxsx0oyGYhXslAAogi3PILS/DpymQQ' +
  '0XskLbikFsk1hxoN5w9X+tq8WR6+T9giI03Wiqey+h8LNz6K35P2NJQ3WLn71mqOEb9YEUoKDReTzMLCA1yJoKia6Y' +
  'JuDgUf1qamN7rRICPVd0wQpinqLYjPpgNPiVqrkGW0CQPZ2SE2tN4uFRIWw45/IITQl0v9ClCkO/gwUtwtuugegrqs' +
  'e0EZ5j2V4a1XDmVuJaS33pAVLoUgK0M8RG72';

/** Template .mrt dibaca dari <project-root>/reports, font dari <project-root>/fonts. */
const REPORTS_DIR = () => path.join(process.cwd(), 'reports');
const FONTS_DIR = () => path.join(process.cwd(), 'fonts');

@Injectable()
export class ReportPdfService {
  private readonly logger = new Logger(ReportPdfService.name);
  private stimulsoft: any = null;

  /**
   * Stimulsoft di-load lazy + sekali saja. Modulnya berat (beberapa MB) dan
   * registrasi font/lisensi bersifat global, jadi tidak perlu diulang tiap job.
   */
  private getStimulsoft(): any {
    if (this.stimulsoft) return this.stimulsoft;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Stimulsoft = require('stimulsoft-reports-js');

    const fonts: Array<[string, string]> = [
      ['tahoma.ttf', 'Tahoma'],
      ['tahomabd.ttf', 'Tahoma'],
    ];

    for (const [file, family] of fonts) {
      const fontPath = path.join(FONTS_DIR(), file);
      if (!existsSync(fontPath)) {
        this.logger.warn(
          `Font tidak ditemukan: ${fontPath} — laporan tetap dirender dengan font fallback`,
        );
        continue;
      }
      Stimulsoft.Base.StiFontCollection.addOpentypeFontFile(fontPath, family);
    }

    Stimulsoft.Base.StiLicense.Key = STIMULSOFT_LICENSE_KEY;

    this.stimulsoft = Stimulsoft;
    return Stimulsoft;
  }

  /**
   * Render satu template .mrt menjadi buffer PDF.
   *
   * Bentuk dataset dibuat identik dengan yang dulu dipakai di browser:
   *   new DataSet('Data') + readJson({ [tableName]: rows }) + regData('Data', '', dataSet)
   * Template lama (mis. LaporanGroupbiayaextra.mrt) mereferensikan kolom
   * lewat `Data.data`, jadi nama tabel default sengaja huruf kecil `data`.
   * Mengubahnya akan membuat PDF ter-render kosong.
   */
  async generatePdf(
    rows: any[],
    mrtName: string,
    tableName = 'data',
  ): Promise<Buffer> {
    if (!mrtName || !mrtName.trim()) {
      throw new HttpException(
        'Field "mrtName" wajib diisi.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Tolak path traversal: mrtName datang dari body request.
    const safeName = path.basename(mrtName);
    if (safeName !== mrtName || !safeName.toLowerCase().endsWith('.mrt')) {
      throw new HttpException(
        `Nama template tidak valid: "${mrtName}".`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const templatePath = path.join(REPORTS_DIR(), safeName);
    if (!existsSync(templatePath)) {
      throw new HttpException(
        `Template laporan tidak ditemukan: ${safeName}. Letakkan file .mrt di folder "reports".`,
        HttpStatus.NOT_FOUND,
      );
    }

    const Stimulsoft = this.getStimulsoft();

    const report = new Stimulsoft.Report.StiReport();
    report.loadFile(templatePath);

    const dataSet = new Stimulsoft.System.Data.DataSet('Data');
    dataSet.readJson(JSON.stringify({ [tableName]: rows }));

    report.dictionary.dataSources.clear();
    report.regData('Data', '', dataSet);
    report.dictionary.synchronize();

    this.logger.log(
      `[generatePdf] render → template=${safeName}, table=${tableName}, rows=${rows.length}`,
    );

    return new Promise<Buffer>((resolve, reject) => {
      try {
        report.renderAsync(() => {
          try {
            report.exportDocumentAsync((pdfData: Uint8Array) => {
              resolve(Buffer.from(pdfData));
            }, Stimulsoft.Report.StiExportFormat.Pdf);
          } catch (err) {
            reject(err);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }
}
