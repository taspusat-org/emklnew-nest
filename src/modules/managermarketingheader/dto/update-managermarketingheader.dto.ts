import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';

export const UpdateManagermarketingDetailSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  nominalawal: z.string().nullable(),
  nominalakhir: z.string().nullable(),
  persentase: z.string().nullable(),
  statusaktif: z.string().nullable(),
});

export type UpdateManagermarketingDetailDto = z.infer<
  typeof UpdateManagermarketingDetailSchema
>;

export const UpdateManagermarketingHeaderSchema = z
  .object({
    id: z.number().optional(),
    nama: z.string().trim().min(1, { message: 'Nama Wajib Diisi' }).max(100),
    keterangan: z.string().trim().min(1, { message: 'Keterangan wajib diisi' }),
    minimalprofit: z
      .string()
      .trim()
      .min(1, { message: 'Minimal profit wajib diisi' }),
    statusmentor: z.string().nullable(),
    statusmentor_text: z.string().nullable().optional(),
    statusleader: z.string().nullable(),
    statusleader_text: z.string().nullable().optional(),
    statusaktif: z.string().nullable(),
    text: z.string().nullable().optional(),
    info: z.string().nullable().optional(),
    modifiedby: z.string().nullable().optional(),
    details: z
      .array(UpdateManagermarketingDetailSchema)
      .min(1, { message: 'Details minimal 1 data' }),
  })

  .superRefine((data, ctx) => {
    if (data.details && Array.isArray(data.details)) {
      data.details.forEach((detail, index) => {
        const nominalawal = detail.nominalawal
          ? Number(detail.nominalawal)
          : null;
        const nominalakhir = detail.nominalakhir
          ? Number(detail.nominalakhir)
          : null;
        const persentase = detail.persentase ? Number(detail.persentase) : null;

        if (
          nominalawal !== null &&
          nominalakhir !== null &&
          nominalakhir <= nominalawal
        ) {
          ctx.addIssue({
            path: ['details', index, 'nominalakhir'],
            code: z.ZodIssueCode.custom,
            message: `Nominal Akhir > Nominal Awal !`,
          });
        }

        // cek persentase ≤ 100
        if (persentase !== null && persentase > 100) {
          ctx.addIssue({
            path: ['details', index, 'persentase'],
            code: z.ZodIssueCode.custom,
            message: `Persentase < 100 !`,
          });
        }
      });
    }
  })

  .superRefine(async (data, ctx) => {
    const existsName = await isRecordExistCI(
      'nama',
      data.nama,
      'managermarketing',
      data.id ?? undefined,
    );
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Manager Marketing dengan nama ini sudah ada',
      });
    }
  });

export type UpdateManagermarketingHeaderDto = z.infer<
  typeof UpdateManagermarketingHeaderSchema
>;
