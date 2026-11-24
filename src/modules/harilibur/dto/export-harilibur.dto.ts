import { z } from 'zod';

export const ExportHariliburSchema = z.object({
  search: z.string().optional(),
  filters: z.record(z.union([z.string(), z.number()]).nullable()).optional(),
  sortBy: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});

export type ExportHariliburDto = z.infer<typeof ExportHariliburSchema>;
