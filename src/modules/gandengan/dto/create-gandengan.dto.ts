import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';
export const CreateGandenganSchema = z.object({
  nama: z
    .string()
    .trim()
    .min(1, { message: 'Nama Wajib Diisi' })
    .max(100)
    .refine(
      async (value) => {
        const exists = await isRecordExistCI('nama', value, 'gandengan');
        return !exists; // Validasi jika nama sudah ada
      },
      {
        message: 'Gandengan dengan dengan nama ini sudah ada',
      },
    ),
  keterangan: z.string().trim().min(1, { message: 'Keterangan Wajib Diisi' }),
  // statusaktif menyimpan id parameter (varchar UUID), bukan angka. Jangan
  // z.number() — frontend mengirim id string sehingga z.number() menolaknya.
  statusaktif: z.string().min(1, { message: 'Status Aktif Wajib Diisi' }),
  statusaktif_text: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});
export type CreateGandenganDto = z.infer<typeof CreateGandenganSchema>;
