import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';
export const CreateDivisiSchema = z.object({
  nama: z
    .string()
    .trim()
    .min(1, { message: 'Nama Wajib Diisi' })
    .max(100)
    .refine(
      async (value) => {
        const exists = await isRecordExistCI('nama', value, 'divisi');
        return !exists; // Validasi jika nama sudah ada
      },
      {
        message: 'Divisi dengan dengan nama ini sudah ada',
      },
    ),
  keterangan: z.string(),
  statusaktif: z.string()
    .min(0, { message: 'statusaktif must be a non-negative integer' }),
  modifiedby: z.string().nullable().optional(),
});

export type CreateDivisiDto = z.infer<typeof CreateDivisiSchema>;
