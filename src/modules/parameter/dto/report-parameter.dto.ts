import { z } from 'zod';

/**
 * Payload cetak laporan Parameter.
 *
 * Bentuknya sengaja sama dengan state `filters` di grid frontend (search
 * global + filter per kolom + sort), ditambah nama template .mrt-nya. `page`
 * dan `limit` tidak dipakai: laporan selalu mengambil SELURUH baris yang lolos
 * filter, bukan hanya halaman yang sedang tampil.
 */
export const ReportParameterSchema = z.object({
  mrtName: z.string().min(1, { message: 'mrtName wajib diisi' }),
  search: z.string().optional(),
  filters: z.record(z.union([z.string(), z.number()]).nullable()).optional(),
  sortBy: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
  /** Judul yang dicetak di header laporan. */
  judullaporan: z.string().optional(),
});

export type ReportParameterDto = z.infer<typeof ReportParameterSchema>;
