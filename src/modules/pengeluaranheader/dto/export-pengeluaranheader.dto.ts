import { z } from 'zod';

/**
 * Payload export Excel daftar Pengeluaran (background job).
 *
 * Bentuknya sengaja sama dengan state `filters` di grid frontend (search
 * global + filter per kolom + sort). `page` dan `limit` tidak dipakai: export
 * selalu mengambil SELURUH baris yang lolos filter, bukan hanya halaman yang
 * sedang tampil.
 *
 * `filters` memuat juga tglDari/tglSampai/bank_id dari filter periode di atas
 * grid — di findAll ketiganya diturunkan ke view lewat GUC per-transaksi, tapi
 * export berjalan tanpa transaksi sehingga buildExportQuery memasangnya
 * sebagai predikat biasa (lihat pengeluaranheader.service.ts).
 */
export const ExportPengeluaranheaderSchema = z.object({
  search: z.string().optional(),
  filters: z.record(z.union([z.string(), z.number()]).nullable()).optional(),
  sortBy: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});

export type ExportPengeluaranheaderDto = z.infer<
  typeof ExportPengeluaranheaderSchema
>;
