import { z } from 'zod';

/**
 * Payload export Excel Pengembalian Kas Gantung (background job): SATU bukti
 * beserta rinciannya, bukan daftar. `id` diambil dari baris yang dicentang di
 * grid — aturannya sama dengan cetak bukti, jadi keduanya selalu memuat
 * transaksi yang sama.
 */
export const ExportPengembaliankasgantungheaderSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((value) => String(value)),
});

export type ExportPengembaliankasgantungheaderDto = z.infer<
  typeof ExportPengembaliankasgantungheaderSchema
>;
