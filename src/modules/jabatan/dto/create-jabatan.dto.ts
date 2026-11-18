import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';
export const CreateJabatanSchema = z.object({
  nama: z
    .string()
    .trim()
    .min(1, { message: 'NAMA WAJIB DIISI' })
    .max(100, { message: 'NAMA MAKSIMAL 100 KARAKTER' })
    .refine(
      async (value) => {
        const exists = await isRecordExistCI('nama', value, 'jabatan');
        return !exists; // Validasi jika nama sudah ada
      },
      {
        message: 'Jabatan dengan nama ini sudah ada',
      },
    ),
  keterangan: z.string().trim().nullable().optional(),

  // statusaktif menyimpan id parameter (varchar UUID), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
  statusaktif: z.string().min(1, { message: 'STATUS AKTIF WAJIB DIISI' }),
  statusaktif_text: z.string().nullable().optional(),

  // divisi_id menyimpan id divisi (varchar UUID), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
  divisi_id: z.string().min(1, { message: 'DIVISI WAJIB DIISI' }),
  divisi_id_text: z.string().nullable().optional(),

  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type CreateJabatanDto = z.infer<typeof CreateJabatanSchema>;
