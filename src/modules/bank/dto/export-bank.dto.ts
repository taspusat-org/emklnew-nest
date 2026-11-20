import { z } from 'zod';

// Sama dengan state filter grid; page/limit diabaikan karena export mengambil semua baris.
export const ExportBankSchema = z.object({
  search: z.string().optional(),
  filters: z.record(z.union([z.string(), z.number()]).nullable()).optional(),
  sortBy: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});

export type ExportBankDto = z.infer<typeof ExportBankSchema>;
