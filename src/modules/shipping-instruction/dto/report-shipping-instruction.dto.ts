import { z } from 'zod';

export const ReportShippingInstructionSchema = z.object({
  mrtName: z.string().min(1, { message: 'mrtName wajib diisi' }),
  id: z.union([z.string(), z.number()]).refine(
    (value) =>
      typeof value === 'number'
        ? Number.isFinite(value) && value > 0
        : String(value).trim() !== '',
    { message: 'id wajib diisi' },
  ),
  judullaporan: z.string().optional(),
});

export type ReportShippingInstructionDto = z.infer<
  typeof ReportShippingInstructionSchema
>;
