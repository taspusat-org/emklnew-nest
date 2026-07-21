import { isRecordExistCI } from 'src/utils/utils.service';
import { z } from 'zod';

export const UpdateJabatanSchema = z
  .object({
    id: z.string().optional(),
    nama: z.string().trim(),
    keterangan: z.string(),
    statusaktif: z.string()
      .min(0, { message: 'statusaktif must be a non-negative integer' }),
    divisi_id: z
      .string()
      .min(1, { message: 'Divisi wajib diisi' }),
    info: z.string().nullable().optional(),
    modifiedby: z.string().nullable().optional(),
  })
  .superRefine(async (data, ctx) => {
    const existsName = await isRecordExistCI(
      'nama',
      data.nama,
      'jabatan',
      data.id ?? undefined,
    );
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Jabatan dengan nama ini sudah ada',
      });
    }
  });

export type UpdateJabatanDto = z.infer<typeof UpdateJabatanSchema>;
