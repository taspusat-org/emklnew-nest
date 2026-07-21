import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';
export const CreateKapalSchema = z.object({
  nama: z
    .string()
    .trim()
    .min(1, { message: 'Nama Wajib Diisi' })
    .max(100)
    .refine(
      async (value) => {
        const exists = await isRecordExistCI('nama', value, 'kapal');
        return !exists; // Validasi jika nama sudah ada
      },
      {
        message: 'Kapal dengan dengan nama ini sudah ada',
      },
    ),
  keterangan: z.string(),
  statusaktif: z.string()
    .min(0, { message: 'statusaktif must be a non-negative integer' }),
  pelayaran_id: z
    .string()
    .min(1, { message: 'Pelayaran wajib diisi' }),
  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type CreateKapalDto = z.infer<typeof CreateKapalSchema>;
