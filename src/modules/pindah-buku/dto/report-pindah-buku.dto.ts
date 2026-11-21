import { z } from 'zod';

export const ReportPindahBukuSchema = z.object({
  mrtName: z.string().min(1, { message: 'mrtName wajib diisi' }),
  id: z.union([z.string(), z.number()]).transform((value) => String(value)),
  judullaporan: z.string().optional(),
});

export type ReportPindahBukuDto = z.infer<typeof ReportPindahBukuSchema>;
