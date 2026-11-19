import { z } from 'zod';
import { formatDateToSQL } from 'src/utils/utils.service';

/**
 * Helper bersama untuk modul hasil generate emklnew-module-kit.
 * Kontrak ada di emklnew-module-kit/README.md ("Fungsi bersama").
 */

type NumberFieldOptions = {
  required: boolean;
  integer?: boolean;
  min?: number;
  max?: number;
};

const isBlank = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === 'string' && value.trim() === '');

/** String/number -> number. Koma ribuan dibuang. Kosong atau tidak valid -> 0. */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Schema angka yang menerima string/number/null (nilai mentah dari form). */
export function zodNumberField(label: string, opts: NumberFieldOptions) {
  const L = label.toUpperCase();
  return z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .superRefine((value, ctx) => {
      if (isBlank(value)) {
        if (opts.required) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${L} WAJIB DIISI` });
        }
        return;
      }
      const n =
        typeof value === 'number'
          ? value
          : Number(String(value).replace(/,/g, '').trim());
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${L} HARUS ANGKA` });
        return;
      }
      if (opts.integer && !Number.isInteger(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${L} HARUS BILANGAN BULAT` });
        return;
      }
      if (opts.min !== undefined && n < opts.min) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${L} MINIMAL ${opts.min}` });
        return;
      }
      if (opts.max !== undefined && n > opts.max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${L} MAKSIMAL ${opts.max}` });
      }
    });
}

/** Schema tanggal string/null, divalidasi lewat formatDateToSQL (DD-MM-YYYY / ISO). */
export function zodDateField(label: string, required: boolean) {
  const L = label.toUpperCase();
  return z
    .string()
    .nullable()
    .optional()
    .superRefine((value, ctx) => {
      if (isBlank(value)) {
        if (required) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${L} WAJIB DIISI` });
        }
        return;
      }
      if (formatDateToSQL(value) === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${L} HARUS BERFORMAT DD-MM-YYYY`,
        });
      }
    });
}
