import { z } from 'zod';

export const ReportBiayaExtraHeaderSchema = z.object({
  mrtName: z.string().min(1, { message: 'mrtName wajib diisi' }),
  id: z.string().min(1, { message: 'id wajib diisi' }),
  judullaporan: z.string().optional(),
});

export type ReportBiayaExtraHeaderDto = z.infer<
  typeof ReportBiayaExtraHeaderSchema
>;
