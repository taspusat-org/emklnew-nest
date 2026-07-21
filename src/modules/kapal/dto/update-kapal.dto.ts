import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';
export const UpdateKapalSchema = z
  .object({
    id: z.string().optional(),
    nama: z.string().trim().min(1, { message: 'Nama Wajib Diisi' }).max(100),
    keterangan: z.string(),
    statusaktif: z.string()
      .min(0, { message: 'statusaktif must be a non-negative integer' }),
    pelayaran_id: z
      .string()
      .min(1, { message: 'Pelayaran wajib diisi' }),
    info: z.string().nullable().optional(),
    modifiedby: z.string().nullable().optional(),
  })

  .superRefine(async (data, ctx) => {
    const existsName = await isRecordExistCI(
      'nama',
      data.nama,
      'kapal',
      data.id ?? undefined,
    );
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Kapal dengan nama ini sudah ada',
      });
    }
  });

export type UpdateKapalDto = z.infer<typeof UpdateKapalSchema>;
