import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';
export const CreateComoditySchema = z.object({
  keterangan: z
    .string()
    .trim()
    .min(1, { message: 'Keterangan Wajib Diisi' })
    .max(100)
    .refine(
      async (value) => {
        const exists = await isRecordExistCI('keterangan', value, 'comodity');
        return !exists; // Validasi jika keterangan sudah ada
      },
      {
        message: 'Comodity dengan keterangan ini sudah ada',
      },
    ),
  rate: z.string().min(1, { message: 'Rate Wajib Diisi' }),
  // statusaktif menyimpan id parameter (varchar UUID), bukan angka. Jangan
  // z.number() — frontend mengirim id string sehingga z.number() menolaknya.
  statusaktif: z.string().min(1, { message: 'Status Aktif Wajib Diisi' }),
  statusaktif_text: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});
export type CreateComodityDto = z.infer<typeof CreateComoditySchema>;
