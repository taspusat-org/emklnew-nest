import { z } from 'zod';

export const ExportPindahBukuSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((value) => String(value)),
});

export type ExportPindahBukuDto = z.infer<typeof ExportPindahBukuSchema>;
