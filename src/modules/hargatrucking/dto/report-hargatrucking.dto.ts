import { z } from 'zod';

export const ReportHargatruckingSchema = z.object({
  mrtName: z.string().min(1, { message: 'mrtName wajib diisi' }),
  search: z.string().optional(),
  filters: z.record(z.union([z.string(), z.number()]).nullable()).optional(),
  sortBy: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
  /** Judul yang dicetak di header laporan. */
  judullaporan: z.string().optional(),
});

export type ReportHargatruckingDto = z.infer<typeof ReportHargatruckingSchema>;
