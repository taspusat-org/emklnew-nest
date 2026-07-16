import { z } from 'zod';

export const CreateAsalKapalSchema = z.object({
  nominal: z.string(),
  keterangan: z.string(),
  statusaktif: z.string()
    .min(0, { message: 'statusaktif must be a non-negative integer' }),
  cabang_id: z
    .number()
    .int({ message: 'cabang_id must be an integer' })
    .min(0, { message: 'cabang_id must be a non-negative integer' }),
  container_id: z
    .number()
    .int({ message: 'container_id must be an integer' })
    .min(0, { message: 'container_id must be a non-negative integer' }),
  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type CreateAsalKapalDto = z.infer<typeof CreateAsalKapalSchema>;
