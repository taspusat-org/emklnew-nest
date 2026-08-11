import { z } from 'zod';

/**
 * Payload export Excel Kas Gantung (background job): SATU bukti beserta
 * rinciannya, bukan daftar. `id` diambil dari baris yang dicentang di grid —
 * aturannya sama dengan cetak bukti, jadi keduanya selalu memuat transaksi
 * yang sama.
 */
export const ExportKasgantungheaderSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((value) => String(value)),
});

export type ExportKasgantungheaderDto = z.infer<
  typeof ExportKasgantungheaderSchema
>;
