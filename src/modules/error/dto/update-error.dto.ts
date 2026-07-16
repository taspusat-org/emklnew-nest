import { z } from 'zod';

export const UpdateErrorSchema = z.object({
  kode: z.string().max(255).optional(), // Nullable field
  ket: z.string().max(255).optional(), // Nullable field
  modifiedby: z.string().max(50).optional(), // Nullable field
  created_at: z.string().optional(), // Can still be a string (ISO Date format)
  updated_at: z.string().optional(), // Can still be a string (ISO Date format)
});

export type UpdateErrorDto = z.infer<typeof UpdateErrorSchema>;
