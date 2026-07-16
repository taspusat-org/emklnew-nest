import { isRecordExistCI } from 'src/utils/utils.service';
import { z } from 'zod';

export const UpdateJenissealSchema = z
  .object({
    // id & status* = varchar UUID, bukan angka. z.number() bikin self-exclude
    // di isRecordExist meleset (id UUID != angka) sehingga edit tanpa ganti
    // nama salah dianggap "nama sudah ada".
    id: z.string().optional(),
    nama: z
      .string()
      .trim()
      .min(1, { message: 'Jenis Seal Wajib Diisi' })
      .max(255),
    keterangan: z.string().trim().min(1, { message: 'Keterangan Wajib Diisi' }),

    statusaktif: z.string().min(1, { message: 'Status Aktif is required' }),
    statusaktif_text: z.string().nullable().optional(),

    modifiedby: z.string().nullable().optional(),
  })
  .superRefine(async (data, ctx) => {
    const existsName = await isRecordExistCI(
      'nama',
      data.nama,
      'jenisseal',
      data.id ?? undefined,
    );
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Jenis Seal dengan nama ini sudah ada',
      });
    }
  });

export type UpdateJenissealDto = z.infer<typeof UpdateJenissealSchema>;
