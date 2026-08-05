/**
 * Ejaan angka ke huruf (bahasa Indonesia) untuk baris "terbilang" di laporan.
 *
 * Port dari lib/utils/terbilang.ts milik frontend — dipindah ke backend karena
 * cetak laporan kini dirender di sini (lihat ReportJobService), bukan lagi di
 * browser. Keluarannya HARUS sama persis dengan versi frontend supaya bukti
 * yang dicetak sebelum dan sesudah migrasi tidak berbeda bunyinya.
 */

export interface TerbilangOptions {
  /** "SERATUS"/"SERIBU" (true) atau "SATU RATUS"/"SATU RIBU" (false). */
  preferSeForSeratusSeribu?: boolean;
  negativeWord?: string;
  decimalWord?: string;
}

const DIGITS = [
  'NOL',
  'SATU',
  'DUA',
  'TIGA',
  'EMPAT',
  'LIMA',
  'ENAM',
  'TUJUH',
  'DELAPAN',
  'SEMBILAN',
] as const;

const SCALES = [
  '', // 10^0
  'RIBU', // 10^3
  'JUTA', // 10^6
  'MILIAR', // 10^9
  'TRILIUN', // 10^12
  'KUADRILIUN', // 10^15
  'KUINTILIUN', // 10^18
  'SEKSTILIUN', // 10^21
  'SEPTILIUN', // 10^24
  'OKTILIUN', // 10^27
  'NONILIUN', // 10^30
  'DESILIUN', // 10^33
];

function threeDigitsToWords(n: number, preferSeForSeratus: boolean): string {
  if (n === 0) return '';

  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const tensUnits = n % 100;
  const tens = Math.floor(tensUnits / 10);
  const units = tensUnits % 10;

  if (hundreds > 0) {
    if (hundreds === 1) {
      parts.push(preferSeForSeratus ? 'SERATUS' : 'SATU RATUS');
    } else {
      parts.push(`${DIGITS[hundreds]} RATUS`);
    }
  }

  if (tensUnits > 0) {
    if (tensUnits < 10) {
      parts.push(DIGITS[units]);
    } else if (tensUnits === 10) {
      parts.push('SEPULUH');
    } else if (tensUnits === 11) {
      parts.push('SEBELAS');
    } else if (tensUnits < 20) {
      parts.push(`${DIGITS[units]} BELAS`);
    } else {
      parts.push(`${DIGITS[tens]} PULUH`);
      if (units > 0) parts.push(DIGITS[units]);
    }
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function splitByThousands(intStr: string): string[] {
  const groups: string[] = [];
  for (let i = intStr.length; i > 0; i -= 3) {
    const start = Math.max(0, i - 3);
    groups.unshift(intStr.slice(start, i));
  }
  return groups;
}

function integerToWords(
  intStr: string,
  opts: Required<Pick<TerbilangOptions, 'preferSeForSeratusSeribu'>>,
): string {
  intStr = intStr.replace(/^0+(?=\d)/, '');
  if (intStr === '' || /^0+$/.test(intStr)) return 'NOL';

  const groups = splitByThousands(intStr);
  const parts: string[] = [];

  groups.forEach((grp, idx) => {
    const scaleIdx = groups.length - 1 - idx; // 0 = satuan, 1 = RIBU, dst.
    const n = parseInt(grp, 10);
    if (n === 0) return;

    if (scaleIdx === 1 && n === 1) {
      parts.push(opts.preferSeForSeratusSeribu ? 'SERIBU' : 'SATU RIBU');
      return;
    }

    // 1 juta/miliar/triliun/... -> "SATU JUTA", bukan "SEJUTA".
    if (n === 1 && scaleIdx >= 2) {
      parts.push(`SATU ${SCALES[scaleIdx]}`);
      return;
    }

    const chunkWords = threeDigitsToWords(n, opts.preferSeForSeratusSeribu);
    const scaleWord = SCALES[scaleIdx];
    parts.push(scaleWord ? `${chunkWords} ${scaleWord}` : chunkWords);
  });

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function detectAndNormalize(input: string): {
  negative: boolean;
  integer: string;
  fraction: string;
} {
  let s = input.trim();

  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }

  s = s.replace(/[\s_]/g, '');
  // Buang simbol lain (mis. "Rp"), sisakan digit dan pemisah.
  s = s.replace(/[^\d.,]/g, '');

  const dotCount = (s.match(/\./g) || []).length;
  const commaCount = (s.match(/,/g) || []).length;

  let decimalSep: '.' | ',' | null = null;

  if (dotCount > 0 && commaCount > 0) {
    // Ada keduanya: pemisah desimal adalah yang paling kanan.
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    decimalSep = lastDot > lastComma ? '.' : ',';
  } else if (dotCount === 1 && commaCount === 0) {
    const pos = s.indexOf('.');
    decimalSep = pos > 0 && pos < s.length - 1 ? '.' : null;
  } else if (commaCount === 1 && dotCount === 0) {
    const pos = s.indexOf(',');
    decimalSep = pos > 0 && pos < s.length - 1 ? ',' : null;
  } else {
    decimalSep = null;
  }

  let integer = s;
  let fraction = '';

  if (decimalSep) {
    const [lhs, rhs] = s.split(decimalSep);
    integer = lhs;
    fraction = rhs || '';
  }

  integer = integer.replace(/[.,]/g, '');
  fraction = fraction.replace(/[.,]/g, '');

  if (integer === '') integer = '0';

  return { negative, integer, fraction };
}

export function numberToTerbilang(
  value: number | string,
  options?: TerbilangOptions,
): string {
  const opts: Required<TerbilangOptions> = {
    preferSeForSeratusSeribu: options?.preferSeForSeratusSeribu ?? true,
    negativeWord: options?.negativeWord ?? 'MINUS',
    decimalWord: options?.decimalWord ?? 'KOMA',
  };

  const raw = typeof value === 'number' ? value.toString() : String(value);

  const { negative, integer, fraction } = detectAndNormalize(raw);

  const intWords = integerToWords(integer, {
    preferSeForSeratusSeribu: opts.preferSeForSeratusSeribu,
  });
  const parts: string[] = [];

  if (negative && !(integer === '0' && fraction.replace(/0+/g, '') === '')) {
    parts.push(opts.negativeWord);
  }

  parts.push(intWords);

  if (fraction && fraction.length > 0) {
    // Desimal dibaca per digit.
    const fracParts = Array.from(fraction).map(
      (ch) => DIGITS[parseInt(ch, 10) || 0],
    );
    parts.push(opts.decimalWord, ...fracParts);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
