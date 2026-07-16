import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';
export const CreateAlatbayarSchema = z.object({
  nama: z
    .string()
    .trim()
    .min(1, { message: 'Nama Wajib Diisi' })
    .max(100)
    .refine(
      async (value) => {
        const exists = await isRecordExistCI('nama', value, 'alatbayar');
        return !exists; // Validasi jika nama sudah ada
      },
      {
        message: 'Alat Bayar dengan dengan nama ini sudah ada',
      },
    ),
  keterangan: z.string().trim().min(1, { message: 'KETERANGAN is required' }),

  // status* menyimpan id parameter (varchar UUID), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
  statuslangsungcair: z
    .string()
    .min(1, { message: 'Status Langsung Cair is required' }),
  statuslangsungcair_text: z.string().nullable().optional(),

  statusdefault: z.string().min(1, { message: 'Status Default is required' }),
  textdefault: z.string().nullable().optional(),

  statusbank: z.string().min(1, { message: 'Status Bank is required' }),
  textbank: z.string().nullable().optional(),

  statusaktif: z.string().min(1, { message: 'Status Aktif is required' }),
  text: z.string().nullable().optional(),

  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type CreateAlatbayarDto = z.infer<typeof CreateAlatbayarSchema>;
