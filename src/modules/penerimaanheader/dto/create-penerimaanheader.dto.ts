import { z } from 'zod';

/**
 * Validasi body Penerimaan Header.
 *
 * Field yang diwajibkan di sini adalah yang memang dibutuhkan service supaya
 * bisa menyelesaikan simpan — bukan sekadar kelengkapan form:
 *  - `bank_id`  : format nomor bukti & COA debet jurnal diambil DARI banknya
 *                 (`resolveFormatPenerimaan`). Tanpa bank, running number dan
 *                 jurnalnya tidak bisa dibentuk.
 *  - `tglbukti` : dipakai generateRunningNumber dan tanggal jurnal.
 *  - `details`  : jurnal umum dirakit dari baris-baris ini, jadi minimal satu
 *                 baris dengan coa + nominal.
 *
 * Kolom `<x>_text` / `<x>_nama` ikut diterima (optional) karena form mengirim
 * label lookup bersama id-nya; keduanya dibuang sebelum insert.
 *
 * Catatan: ZodValidationPipe hanya MEMVALIDASI lalu mengembalikan body aslinya,
 * jadi key tambahan dari grid (filters/sortBy/page/limit/search) tidak ikut
 * terbuang meski tidak dideklarasikan di sini.
 */
const detailFields = z.object({
  id: z.union([z.string(), z.number()]).nullable().optional(),

  coa: z
    .string({ message: 'COA WAJIB DIISI' })
    .nonempty({ message: 'COA WAJIB DIISI' }),

  keterangan: z.string().nullable().optional(),

  nominal: z
    .union([z.string(), z.number()], { message: 'NOMINAL WAJIB DIISI' })
    .refine((v) => String(v ?? '').trim() !== '', {
      message: 'NOMINAL WAJIB DIISI',
    }),

  transaksibiaya_nobukti: z.string().nullable().optional(),
  transaksilain_nobukti: z.string().nullable().optional(),
  pengeluaranemklheader_nobukti: z.string().nullable().optional(),
  penerimaanemklheader_nobukti: z.string().nullable().optional(),
  pengembaliankasgantung_nobukti: z.string().nullable().optional(),
  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

const baseFields = {
  nobukti: z.string().nullable().optional(),

  tglbukti: z
    .string({ message: 'TGL BUKTI WAJIB DIISI' })
    .nonempty({ message: 'TGL BUKTI WAJIB DIISI' }),

  bank_id: z
    .string({ message: 'BANK WAJIB DIISI' })
    .nonempty({ message: 'BANK WAJIB DIISI' }),
  bank_text: z.string().nullable().optional(),
  bank_nama: z.string().nullable().optional(),

  relasi_id: z.string().nullable().optional(),
  relasi_text: z.string().nullable().optional(),
  relasi_nama: z.string().nullable().optional(),

  alatbayar_id: z.string().nullable().optional(),
  alatbayar_text: z.string().nullable().optional(),
  alatbayar_nama: z.string().nullable().optional(),

  coakasmasuk: z.string().nullable().optional(),
  coakasmasuk_text: z.string().nullable().optional(),
  coakasmasuk_nama: z.string().nullable().optional(),

  keterangan: z.string().nullable().optional(),
  diterimadari: z.string().nullable().optional(),
  postingdari: z.string().nullable().optional(),
  nowarkat: z.string().nullable().optional(),
  noresi: z.string().nullable().optional(),
  tgllunas: z.string().nullable().optional(),
  statusformat: z.string().nullable().optional(),
  info: z.string().nullable().optional(),

  // modifiedby diisi di backend dari token, optional di request body.
  modifiedby: z.string().max(200).nullable().optional(),

  details: z
    .array(detailFields, { message: 'DETAIL WAJIB DIISI' })
    .min(1, { message: 'DETAIL WAJIB DIISI MINIMAL 1 BARIS' }),
};

export const CreatePenerimaanheaderSchema = z.object({ ...baseFields });
export type CreatePenerimaanheaderDto = z.infer<
  typeof CreatePenerimaanheaderSchema
>;
