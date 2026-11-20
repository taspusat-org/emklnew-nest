import { isRecordExistCI } from 'src/utils/utils.service';
import { z } from 'zod';

export const UpdateDivisiSchema = z
  .object({
    // id & statusaktif = varchar UUID, bukan angka. z.number() bikin
    // self-exclude di isRecordExistCI meleset (id UUID != angka) sehingga edit
    // tanpa ganti nama salah dianggap "nama sudah ada".
    id: z.string().optional(),
    nama: z.string().min(1, { message: 'NAMA is required' }),
    keterangan: z.string().trim().min(1, { message: 'KETERANGAN is required' }),

    statusaktif: z.string().min(1, { message: 'Status Aktif is required' }),
    text: z.string().nullable().optional(),

    info: z.string().nullable().optional(),
    modifiedby: z.string().nullable().optional(),
  })
  .superRefine(async (data, ctx) => {
    const existsName = await isRecordExistCI(
      'nama',
      data.nama,
      'divisi',
      data.id ?? undefined,
    );
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Divisi dengan nama ini sudah ada',
      });
    }
  });

export type UpdateDivisiDto = z.infer<typeof UpdateDivisiSchema>;
