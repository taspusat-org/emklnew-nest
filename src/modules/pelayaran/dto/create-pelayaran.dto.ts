import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';
export const CreatePelayaranSchema = z.object({
  // relasi_id menyimpan id relasi (varchar UUID), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
  relasi_id: z.string().nullable().optional(),
  relasi_id_text: z.string().nullable().optional(),
  nama: z
    .string()
    .trim()
    .refine(
      async (value) => {
        if (!value) return true;
        const exists = await isRecordExistCI('nama', value, 'pelayaran');
        return !exists; // Validasi jika nama sudah ada
      },
      {
        message: 'Pelayaran dengan nama ini sudah ada',
      },
    )
    .nullable()
    .optional(),
  keterangan: z.string().trim().nullable().optional(),

  // statusaktif menyimpan id parameter (varchar UUID), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
  statusaktif: z.string().nullable().optional(),
  statusaktif_text: z.string().nullable().optional(),

  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type CreatePelayaranDto = z.infer<typeof CreatePelayaranSchema>;
