import { z } from 'zod';

/**
 * Payload export Excel Biaya Extra Header (background job).
 *
 * Bentuknya sengaja sama dengan state `filters` di grid frontend (search
 * global + filter per kolom + rentang tanggal + jenis orderan + sort). `page`
 * dan `limit` tidak dipakai: export selalu mengambil SELURUH baris yang lolos
 * filter, bukan hanya halaman yang sedang tampil.
 */
export const ExportBiayaExtraHeaderSchema = z.object({
  search: z.string().optional(),
  filters: z.record(z.union([z.string(), z.number()]).nullable()).optional(),
  sortBy: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});

export type ExportBiayaExtraHeaderDto = z.infer<
  typeof ExportBiayaExtraHeaderSchema
>;
