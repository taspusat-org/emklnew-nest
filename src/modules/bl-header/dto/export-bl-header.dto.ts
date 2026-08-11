import { z } from 'zod';

/**
 * Payload export Excel BL (background job).
 *
 * Bentuknya sengaja sama dengan state `filters` di grid frontend (search
 * global + filter per kolom + sort). `page` dan `limit` tidak dipakai: export
 * selalu mengambil SELURUH baris yang lolos filter, bukan hanya halaman yang
 * sedang tampil.
 *
 * `filters` ikut membawa tglDari/tglSampai dari FilterGrid. Di jalur grid
 * keduanya jadi predikat di dalam view lewat session context, tapi export
 * mengalirkan baris di luar transaksi — lihat catatan di
 * BlHeaderService.buildExportQuery.
 */
export const ExportBlHeaderSchema = z.object({
  search: z.string().optional(),
  filters: z.record(z.union([z.string(), z.number()]).nullable()).optional(),
  sortBy: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});

export type ExportBlHeaderDto = z.infer<typeof ExportBlHeaderSchema>;
