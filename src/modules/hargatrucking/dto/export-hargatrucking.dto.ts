import { z } from 'zod';

export const ExportHargatruckingSchema = z.object({
  search: z.string().optional(),
  filters: z.record(z.union([z.string(), z.number()]).nullable()).optional(),
  sortBy: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});

export type ExportHargatruckingDto = z.infer<typeof ExportHargatruckingSchema>;
