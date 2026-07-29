import { isRecordExistCI } from 'src/utils/utils.service';
import { z } from 'zod';

export const UpdateDaftarBankSchema = z
  .object({
    id: z.string().optional(),
    nama: z
      .string()
      .trim()
      .min(1, { message: 'Daftar Bank Wajib Diisi' })
      .max(255),
    keterangan: z.string().trim().min(1, { message: 'Keterangan Wajib Diisi' }),
    statusaktif: z.string(), // Ensure non-negative
    modifiedby: z.string().nullable().optional(),
  })
  .superRefine(async (data, ctx) => {
    const existsName = await isRecordExistCI(
      'nama',
      data.nama,
      'daftarbank',
      data.id ?? undefined,
    );
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Daftar Bank dengan nama ini sudah ada',
      });
    }
  });
export type UpdateDaftarBankDto = z.infer<typeof UpdateDaftarBankSchema>;
