import { z } from 'zod';

export const ExportKasgantungheaderSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((value) => String(value)),
});

export type ExportKasgantungheaderDto = z.infer<
  typeof ExportKasgantungheaderSchema
>;
