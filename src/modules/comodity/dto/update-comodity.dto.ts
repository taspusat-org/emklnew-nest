import { isRecordExistCI } from 'src/utils/utils.service';
import { z } from 'zod';

export const UpdateComoditySchema = z
  .object({
    // id & status* = varchar UUID, bukan angka. z.number() bikin self-exclude
    // di isRecordExist meleset (id UUID != angka) sehingga edit tanpa ganti
    // keterangan salah dianggap "keterangan sudah ada".
    id: z.string().optional(),
    keterangan: z
      .string()
      .trim()
      .min(1, { message: 'Keterangan Wajib Diisi' })
      .max(255),
    rate: z.string().min(1, { message: 'Rate Wajib Diisi' }),
    // statusaktif menyimpan id parameter (varchar UUID), bukan angka. Jangan
    // z.number() — frontend mengirim id string sehingga z.number() menolaknya.
    statusaktif: z.string().min(1, { message: 'Status Aktif Wajib Diisi' }),
    statusaktif_text: z.string().nullable().optional(),
    modifiedby: z.string().nullable().optional(),
  })
  .superRefine(async (data, ctx) => {
    const existsName = await isRecordExistCI(
      'keterangan',
      data.keterangan,
      'comodity',
      data.id ?? undefined,
    );
    if (existsName) {
      ctx.addIssue({
        path: ['keterangan'],
        code: 'custom',
        message: 'Comodity dengan keterangan ini sudah ada',
      });
    }
  });
export type UpdateComodityDto = z.infer<typeof UpdateComoditySchema>;
