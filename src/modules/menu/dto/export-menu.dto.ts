import { z } from 'zod';

/**
 * Payload export Excel Menu (background job).
 *
 * Bentuknya sengaja sama dengan state `filters` di grid frontend (search
 * global + filter per kolom + sort). `page` dan `limit` tidak dipakai: export
 * selalu mengambil SELURUH baris yang lolos filter, bukan hanya halaman yang
 * sedang tampil.
 */
export const ExportMenuSchema = z.object({
  search: z.string().optional(),
  filters: z.record(z.union([z.string(), z.number()]).nullable()).optional(),
  sortBy: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});

export type ExportMenuDto = z.infer<typeof ExportMenuSchema>;
