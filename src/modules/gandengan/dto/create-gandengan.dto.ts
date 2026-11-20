import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';
export const CreateGandenganSchema = z.object({
  nama: z
    .string()
    .trim()
    .min(1, { message: 'NAMA WAJIB DIISI' })
    .max(100, { message: 'NAMA MAKSIMAL 100 KARAKTER' })
    .refine(
      async (value) => {
        const exists = await isRecordExistCI('nama', value, 'gandengan');
        return !exists; // Validasi jika nama sudah ada
      },
      {
        message: 'gandengan dengan nama ini sudah ada',
      },
    ),
  keterangan: z.string().trim().nullable().optional(),

  // statusaktif menyimpan id parameter (varchar UUID), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
  statusaktif: z.string().min(1, { message: 'STATUS AKTIF WAJIB DIISI' }),
  statusaktif_text: z.string().nullable().optional(),

  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type CreateGandenganDto = z.infer<typeof CreateGandenganSchema>;
