import { z } from 'zod';

export const CreateAsalKapalSchema = z.object({
  nominal: z.string(),
  keterangan: z.string(),
  statusaktif: z.string()
    .min(0, { message: 'statusaktif must be a non-negative integer' }),
  cabang_id: z
    .string()
    .min(1, { message: 'cabang_id wajib diisi' }),
  container_id: z
    .string()
    .min(1, { message: 'container_id wajib diisi' }),
  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type CreateAsalKapalDto = z.infer<typeof CreateAsalKapalSchema>;
