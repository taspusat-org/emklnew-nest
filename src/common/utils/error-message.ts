export const GENERIC_ERROR_MESSAGE =
  'TERJADI KESALAHAN PADA SISTEM. SILAKAN COBA LAGI ATAU HUBUNGI ADMINISTRATOR.';

// Pola yang menandakan pesan berasal dari driver/knex/runtime, bukan aturan
// bisnis. Pesan seperti ini tidak boleh keluar dari server apa adanya.
const TECHNICAL_SIGNALS: RegExp[] = [
  /\b(?:insert\s+into|delete\s+from|update\s+"?[\w.]+"?\s+set|select\s+[\s\S]+?\s+from)\b/i,
  /values\s*\(\s*\$\d+/i,
  /returning\s+\*/i,
  /violates\s+[\w-]+\s+constraint/i,
  /\b(?:constraint|relation|column|table)\s+"[\w.]+"/i,
  /\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ECONNRESET|EPIPE)\b/,
  /\b(?:ER_[A-Z_]+|ORA-\d+|SQLSTATE|SQLState)\b/,
  /\bat\s+[\w$.<>[\]]+\s*\(.*:\d+:\d+\)/,
  /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|knex)\b/,
  /cannot read propert(?:y|ies) of (?:undefined|null)/i,
  /transaction query already complete/i,
  /^internal server error\.?$/i,
  // Pesan developer berbahasa Inggris dari service, mis. 'Failed to fetch
  // alatbayar data'. Pesan untuk user di sistem ini selalu bahasa Indonesia.
  /^(?:failed|unable|error)\b/i,
];

const columnLabel = (column: string): string =>
  column.replace(/_/g, ' ').trim().toUpperCase();

// Nama constraint di db ini berpola FK_<tabel>_<kolom>_<tabel referensi>.
const columnFromConstraint = (
  constraint: string,
  table: string,
): string | null => {
  const cleaned = constraint.replace(/^(?:fk|uq|pk|ck|idx)_/i, '');
  const prefix = `${table.toLowerCase()}_`;
  if (!cleaned.toLowerCase().startsWith(prefix)) return null;

  const parts = cleaned.slice(prefix.length).split('_').filter(Boolean);
  if (parts.length === 0) return null;
  return parts.length > 1 ? parts.slice(0, -1).join('_') : parts[0];
};

const RULES: Array<{ test: RegExp; build: (m: RegExpMatchArray) => string }> = [
  {
    test: /insert or update on table "?([\w.]+)"?\s+violates foreign key constraint "?([\w-]+)"?/i,
    build: (m) => {
      const column = columnFromConstraint(m[2], m[1]);
      return column
        ? `ISIAN ${columnLabel(column)} BELUM DIPILIH ATAU TIDAK TERDAFTAR. SILAKAN PILIH DARI DAFTAR YANG TERSEDIA.`
        : 'ADA ISIAN YANG BELUM DIPILIH ATAU TIDAK TERDAFTAR. SILAKAN PERIKSA KEMBALI DATA YANG DIINPUT.';
    },
  },
  {
    test: /update or delete on table "?[\w.]+"?\s+violates foreign key constraint/i,
    build: () =>
      'DATA TIDAK DAPAT DIHAPUS ATAU DIUBAH KARENA MASIH DIGUNAKAN PADA DATA LAIN.',
  },
  {
    test: /duplicate key value violates unique constraint|violation of unique key constraint|duplicate entry/i,
    build: () => 'DATA SUDAH ADA. SILAKAN GUNAKAN NILAI YANG BERBEDA.',
  },
  {
    test: /null value in column "?([\w]+)"?[\s\S]*?violates not-null constraint|cannot insert the value null into column '([\w]+)'/i,
    build: (m) => {
      const column = m[1] ?? m[2];
      return column
        ? `KOLOM ${columnLabel(column)} WAJIB DIISI.`
        : 'ADA KOLOM WAJIB YANG BELUM DIISI.';
    },
  },
  {
    test: /violates check constraint/i,
    build: () =>
      'DATA YANG DIINPUT TIDAK SESUAI KETENTUAN. SILAKAN PERIKSA KEMBALI.',
  },
  {
    test: /value too long for type|string or binary data would be truncated/i,
    build: () => 'ISIAN TERLALU PANJANG. SILAKAN PERPENDEK ISIAN ANDA.',
  },
  {
    test: /invalid input syntax|conversion failed when converting|error converting data type|out of range value/i,
    build: () =>
      'FORMAT DATA TIDAK SESUAI. SILAKAN PERIKSA KEMBALI ISIAN ANGKA ATAU TANGGAL.',
  },
  {
    test: /deadlock|lock wait timeout|could not serialize access|transaction query already complete|request timeout|melebihi batas waktu/i,
    build: () =>
      'SISTEM SEDANG SIBUK MEMPROSES DATA LAIN. SILAKAN COBA BEBERAPA SAAT LAGI.',
  },
  {
    test: /\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ECONNRESET)\b|connection (?:terminated|refused)/i,
    build: () => 'KONEKSI KE DATABASE TERPUTUS. SILAKAN COBA LAGI.',
  },
];

export const isTechnicalErrorMessage = (message: string): boolean =>
  TECHNICAL_SIGNALS.some((pattern) => pattern.test(message));

/**
 * Terjemahkan pesan teknis (SQL, constraint, stack trace) jadi kalimat yang
 * bisa dimengerti user. Pesan yang memang ditulis untuk user — aturan bisnis
 * berbahasa Indonesia — dikembalikan apa adanya.
 */
export const toSafeErrorMessage = (message: unknown): string => {
  if (typeof message !== 'string' || message.trim() === '')
    return GENERIC_ERROR_MESSAGE;

  const raw = message.trim();
  if (!isTechnicalErrorMessage(raw)) return raw;

  for (const rule of RULES) {
    const match = raw.match(rule.test);
    if (match) return rule.build(match);
  }
  return GENERIC_ERROR_MESSAGE;
};
