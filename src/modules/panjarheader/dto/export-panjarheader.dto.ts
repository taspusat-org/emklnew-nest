import { z } from 'zod';

/**
 * Payload export Excel Panjar (background job).
 *
 * Bentuknya sengaja sama dengan state `filters` di grid frontend (search
 * global + filter per kolom + sort). `page` dan `limit` tidak dipakai: export
 * selalu mengambil SELURUH baris yang lolos filter, bukan hanya halaman yang
 * sedang tampil.
 *
 * `filters` di sini ikut membawa tglDari/tglSampai/jenisOrderan dari FilterGrid.
 * Di jalur grid ketiganya jadi predikat di dalam view lewat session context,
 * tapi export mengalirkan baris di luar transaksi — lihat catatan di
 * PanjarheaderService.buildExportQuery.
 */
export const ExportPanjarheaderSchema = z.object({
  search: z.string().optional(),
  filters: z.record(z.union([z.string(), z.number()]).nullable()).optional(),
  sortBy: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});

export type ExportPanjarheaderDto = z.infer<typeof ExportPanjarheaderSchema>;
