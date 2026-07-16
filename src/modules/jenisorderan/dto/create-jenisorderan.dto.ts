import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';
export const CreateJenisOrderanSchema = z.object({
  nama: z
    .string()
    .trim()
    .min(1, { message: 'Nama Wajib Diisi' })
    .max(100)
    .refine(
      async (value) => {
        const exists = await isRecordExistCI('nama', value, 'jenisorder');
        return !exists; // Validasi jika nama sudah ada
      },
      {
        message: 'Jenis Orderan dengan dengan nama ini sudah ada',
      },
    ),
  keterangan: z.string().trim().min(1, { message: 'KETERANGAN is required' }),

  // statusformat & statusaktif menyimpan id parameter (varchar UUID), bukan
  // angka. Jangan z.number() — frontend mengirim id string sehingga z.number()
  // menolaknya.
  statusformat: z.string().min(1, { message: 'Format is required' }),
  statusformat_nama: z.string().nullable().optional(),

  statusaktif: z.string().min(1, { message: 'Status Aktif is required' }),
  statusaktif_text: z.string().nullable().optional(),

  modifiedby: z.string().nullable().optional(),
});
export type CreateJenisOrderanDto = z.infer<typeof CreateJenisOrderanSchema>;
