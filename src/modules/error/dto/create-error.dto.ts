import { z } from 'zod';

export const CreateErrorSchema = z.object({
  kode: z.string().max(255).optional(), // Nullable field
  ket: z.string().max(255).optional(), // Nullable field
  modifiedby: z.string().max(50).optional(), // Nullable field
  statusaktif: z.string().max(50).optional(), // Nullable field
});

export type CreateErrorDto = z.infer<typeof CreateErrorSchema>;
