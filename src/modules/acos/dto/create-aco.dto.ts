import { z } from 'zod';

export const CreateAcosSchema = z.object({
  class: z.string().min(1, 'class is required'),
  method: z.string().min(1, 'method is too short'),
  nama: z.string().min(1, 'nama is required'),
  modifiedby: z.string().min(0, 'modifiedby cannot be negative'),
});

export type CreateAcosDto = z.infer<typeof CreateAcosSchema>;
