import { Injectable } from '@nestjs/common';
import { dbMssql } from 'src/common/utils/db';
import { formatDateToSQL } from 'src/utils/utils.service';

@Injectable()
export class RunningNumberService {
  async getLastNumber(
    trx: any,
    table: string,
    year: number,
    month: number,
    type: string,
    statusformat: string,
    field?: string | null,
  ) {
    const fixField = field ? field : 'nobukti';

    if (type === 'RESET BULAN') {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 1);
      const formatDate = (date: Date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      };

      const startDateStr = formatDate(startDate);
      const endDateStr = formatDate(endDate);

      // ✅ OPTIMASI: Tambah READUNCOMMITTED + limit untuk performa
      const rows = await trx
        .from(trx.raw(`${table}`))
        .select(`${fixField} as nobukti`)
        .where('tglbukti', '>=', startDateStr)
        .andWhere('tglbukti', '<', endDateStr)
        .orderBy(fixField, 'desc') // DESC untuk ambil yang terbaru dulu
        .limit(1000); // Limit untuk hindari load semua data

      return rows;
    }

    if (type === 'RESET TAHUN') {
      const startDate = `${year}-01-01`;
      const endDate = `${year + 1}-01-01`;

      // ✅ OPTIMASI: Hapus forUpdate yang bisa deadlock + tambah hint
      const rows = await trx
        .from(trx.raw(`${table}`))
        .select(`${fixField} as nobukti`)
        .where('tglbukti', '>=', startDate)
        .andWhere('tglbukti', '<', endDate)
        .orderBy(fixField, 'desc') // DESC untuk ambil yang terbaru dulu
        .limit(1000); // Limit untuk hindari load semua data

      return rows;
    }

    // ✅ OPTIMASI: Query tanpa filter date (harus limited!)
    const rows = await trx
      .from(trx.raw(`${table}`))
      .select(`${fixField} as nobukti`)
      .orderBy(fixField, 'desc') // DESC untuk ambil yang terbaru dulu
      .limit(1000); // Limit wajib untuk kasus ini

    return rows;
  }

  async saveRunningNumber(
    table: string,
    data: { nobukti: string; tglbukti: string; statusformat: string },
  ) {
    return dbMssql(table).insert(data);
  }

  extractPrefixFromFormat(format: string): string {
    let match = format.match(/^([A-Z]+)\s*#/);
    if (match) {
      return match[1].trim();
    }

    match = format.match(/^([A-Z]+)\s*\d/);
    if (match) {
      return match[1].trim();
    }

    match = format.match(/^([A-Z]+)/);
    return match ? match[1].trim() : '';
  }

  createPatternForMatching(
    format: string,
    placeholders: { [key: string]: any },
  ): string {
    let pattern = format;

    // Replace pola angka dengan capture group
    pattern = pattern.replace(/#(9+)#/g, '(\\d+)');
    pattern = pattern.replace(/^(9+)#/g, '(\\d+)');

    console.log('Pattern after number replacement:', pattern);

    // Replace semua placeholder - support both #KEY# and #KEY
    // Definisikan urutan eksplisit untuk menghindari konflik (terpanjang dulu)
    const keysOrder = ['NC', 'R', 'T', 'P', 'M', 'Y', 'y', 'C'];

    for (const key of keysOrder) {
      if (placeholders[key] !== undefined) {
        const value = placeholders[key];
        const escapedValue = this.escapeRegex(value.toString());

        // Coba replace format #KEY# dulu
        const placeholderPatternFull = `#${key}#`;
        if (pattern.includes(placeholderPatternFull)) {
          pattern = pattern.split(placeholderPatternFull).join(escapedValue);
          console.log(
            `Replaced ${placeholderPatternFull} with "${value}", pattern now: ${pattern}`,
          );
          continue;
        }

        // Kalau tidak ada, coba format #KEY (tanpa # di akhir)
        // PENTING: Pastikan setelah KEY bukan huruf (gunakan regex dengan lookahead)
        const placeholderPatternShort = `#${key}`;
        const regexShort = new RegExp(`#${key}(?![A-Z])`, 'g');
        if (regexShort.test(pattern)) {
          pattern = pattern.replace(regexShort, escapedValue);
          console.log(
            `Replaced ${placeholderPatternShort} with "${value}", pattern now: ${pattern}`,
          );
        }
      }
    }

    console.log('Pattern before removing #:', pattern);

    // Hapus semua tanda '#' yang tersisa
    pattern = pattern.replace(/#/g, '');

    console.log('Final pattern:', pattern);

    return pattern;
  }

  escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async generateRunningNumber(
    trx: any,
    group: string,
    subGroup: string,
    table: string,
    tgl: string,
    cabang?: string | null,
    tujuan?: string | null,
    jenisbiaya?: string | null,
    marketing?: string | null,
    pelayaran?: string | null,
    field?: string | null,
  ): Promise<string> {
    const date = formatDateToSQL(tgl);
    if (!date) {
      throw new Error('Tanggal tidak valid!');
    }
    const dateParts = date.split('-');
    if (dateParts.length < 2 || !dateParts[0] || !dateParts[1]) {
      throw new Error('Format tanggal tidak valid!');
    }
    const year = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10);

    const parameter = await trx('parameter')
      .select('id', 'text', 'type')
      .where('grp', group)
      .andWhere('subgrp', subGroup)
      .first();

    if (!parameter) {
      throw new Error('Parameter tidak ditemukan!');
    }

    const typeformat = await trx('parameter')
      .select('text')
      .where('id', parameter.type)
      .first();

    const format = parameter.text;
    // typeformat bisa undefined kalau parameter.type tidak resolve ke baris
    // parameter manapun (mis. kolom `type` masih berisi nilai integer lama
    // seperti '4' sisa sebelum migrasi id ke UUID). Tanpa optional-chaining,
    // `typeformat.text` melempar TypeError -> generateRunningNumber gagal ->
    // SEMUA create yang butuh nomor bukti (pengeluaran, penerimaan, dll) 500.
    // Fallback ke '' = mode tanpa reset (nomor tetap unik via getLastNumber).
    const type = typeformat?.text || '';

    let cabangData = '';
    let namaCabang = '';
    if (cabang) {
      const datacabang = await trx('cabang')
        .select('kodecabang', 'nama')
        .where('id', cabang)
        .first();
      cabangData = datacabang.kodecabang;
      namaCabang = datacabang.nama;
    }

    let tujuanData = '';
    if (tujuan) {
      const datatujuan = await trx('tujuankapal')
        .select('kode')
        .where('id', tujuan)
        .first();
      tujuanData = datatujuan.kode;
    }

    let marketingData = '';
    if (marketing) {
      const datamarketing = await trx('marketing')
        .select('kode')
        .where('id', marketing)
        .first();
      marketingData = datamarketing.kode;
    }

    let namaPelayaran = '';
    if (pelayaran) {
      const dataPelayaran = await trx('pelayaran')
        .select('nama')
        .where('id', pelayaran)
        .first();
      namaPelayaran = dataPelayaran.nama;
    }

    const placeholders = {
      R: this.numberToRoman(month),
      M: marketingData,
      T: tujuanData,
      y: year.toString().slice(-2),
      Y: year.toString(),
      C: cabangData || '',
      NC: namaCabang || '',
      P: namaPelayaran || '',
    };

    console.log('Placeholders:', placeholders);

    // Buat pattern untuk matching
    const pattern = this.createPatternForMatching(format, placeholders);
    console.log('Pattern for matching:', pattern);

    const lastRowData = await this.getLastNumber(
      trx,
      table,
      year,
      month,
      type,
      parameter.id,
      field,
    );

    console.log('lastRowData:', lastRowData);
    console.log('format:', format);

    // Filter nobukti berdasarkan pattern
    const regex = new RegExp(`^${pattern}$`);
    const filteredRows = lastRowData.filter((row) => {
      const isMatch = regex.test(row.nobukti);
      console.log(`Testing: ${row.nobukti} against pattern = ${isMatch}`);
      return isMatch;
    });

    console.log('filteredRows:', filteredRows);

    // Ekstrak angka dari nobukti yang match
    const usedNumbers = filteredRows
      .map((row) => {
        const match = row.nobukti.match(regex);
        if (match && match[1]) {
          const num = parseInt(match[1], 10);
          console.log(`Extracted number from ${row.nobukti}: ${num}`);
          return num;
        }
        return null;
      })
      .filter((num) => num !== null);

    console.log('usedNumbers:', usedNumbers);

    // Cari nomor terkecil yang belum dipakai
    let nextNumber = 1;
    if (usedNumbers.length > 0) {
      usedNumbers.sort((a, b) => a - b);
      for (let i = 0; i < usedNumbers.length; i++) {
        if (usedNumbers[i] !== nextNumber) {
          break;
        }
        nextNumber++;
      }
    }

    console.log('nextNumber:', nextNumber);

    // Hitung digit dari format
    const digitMatch = format.match(/#?(9+)#/);
    let digitCount = 0;
    if (digitMatch) {
      digitCount = digitMatch[1].length;
    }

    let nextNumberString = nextNumber.toString();
    if (digitCount > 0) {
      nextNumberString = nextNumberString.padStart(digitCount, '0');
    }

    let runningNumber = this.formatNumber(
      format,
      placeholders,
      nextNumberString,
    );

    // Loop cek keunikan nomor
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10000;

    while (!isUnique && attempts < maxAttempts) {
      const existingNobukti = await trx(table)
        .where('nobukti', runningNumber)
        .first();

      if (!existingNobukti) {
        isUnique = true;
      } else {
        nextNumber++;
        nextNumberString = nextNumber.toString().padStart(digitCount, '0');
        runningNumber = this.formatNumber(
          format,
          placeholders,
          nextNumberString,
        );
        attempts++;
      }
    }

    if (attempts >= maxAttempts) {
      throw new Error(
        'Unable to generate unique running number after maximum attempts',
      );
    }

    return runningNumber;
  }

  formatNumber(
    format: string,
    placeholders: { [key: string]: any },
    nextNumberString: string,
  ): string {
    let formatted = format;

    // Replace pola angka
    formatted = formatted.replace(/#(9+)#/g, nextNumberString);
    formatted = formatted.replace(/^(9+)#/g, nextNumberString);

    // Replace placeholder - urutkan dari terpanjang ke terpendek
    const keysOrder = ['NC', 'R', 'T', 'P', 'M', 'Y', 'y', 'C'];

    for (const key of keysOrder) {
      if (placeholders[key] !== undefined) {
        const value = placeholders[key];

        // Coba replace format #KEY# dulu
        const placeholderPatternFull = `#${key}#`;
        if (formatted.includes(placeholderPatternFull)) {
          formatted = formatted
            .split(placeholderPatternFull)
            .join(value.toString());
          continue;
        }

        // Kalau tidak ada, coba format #KEY (tanpa # di akhir)
        // PENTING: Pastikan setelah KEY bukan huruf (gunakan regex dengan lookahead)
        const placeholderPatternShort = `#${key}`;
        const regexShort = new RegExp(`#${key}(?![A-Z])`, 'g');
        if (regexShort.test(formatted)) {
          formatted = formatted.replace(regexShort, value.toString());
        }
      }
    }

    // REMOVED: Bagian backward compatibility yang menyebabkan bug
    // Karena sudah ditangani di atas dengan format #KEY# atau #KEY

    // Hapus semua tanda '#' yang tersisa
    formatted = formatted.replace(/#/g, '');

    console.log('formatted:', formatted);
    return formatted;
  }

  numberToRoman(num: number): string {
    const romanMap = [
      { value: 1000, numeral: 'M' },
      { value: 900, numeral: 'CM' },
      { value: 500, numeral: 'D' },
      { value: 400, numeral: 'CD' },
      { value: 100, numeral: 'C' },
      { value: 90, numeral: 'XC' },
      { value: 50, numeral: 'L' },
      { value: 40, numeral: 'XL' },
      { value: 10, numeral: 'X' },
      { value: 9, numeral: 'IX' },
      { value: 5, numeral: 'V' },
      { value: 4, numeral: 'IV' },
      { value: 1, numeral: 'I' },
    ];

    return romanMap.reduce((acc, { value, numeral }) => {
      const count = Math.floor(num / value);
      num %= value;
      return acc + numeral.repeat(count);
    }, '');
  }
}
