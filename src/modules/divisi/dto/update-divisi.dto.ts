import { isRecordExistCI } from 'src/utils/utils.service';
import { z } from 'zod';

export const UpdateDivisiSchema = z
  .object({
    nama: z.string().trim(),
    id: z.number().optional(),
    keterangan: z.string(),
    statusaktif: z.string()
      .min(0, { message: 'statusaktif must be a non-negative integer' }),
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
