import { z } from 'zod';
import { dbMssql } from 'src/common/utils/db';

export const UpdateBiayaSchema = z
  .object({
    id: z.number().optional(),
    nama: z.string().trim().min(1, { message: 'NAMA is required' }),

    keterangan: z.string().trim().min(1, { message: 'KETERANGAN is required' }),

    coa: z.string().nullable().optional(),
    keterangancoa: z.string().nullable().optional(),

    coahut: z.string().nullable().optional(),
    keterangancoahut: z.string().nullable().optional(),

    jenisorder_id: z.string().optional().nullable(),
    jenisorderan_text: z.string().nullable().optional(),

    statusaktif: z.string().min(1, { message: 'STATUSAKTIF is required' }),
    text: z.string().nullable().optional(),

    info: z.string().nullable().optional(),
    modifiedby: z.string().nullable().optional(),
  })

  .superRefine(async (data, ctx) => {
    const coaValue = data.coa;
    const coahutValue = data.coahut;

    if (coaValue != null && coahutValue != null) {
      if (coaValue === coahutValue) {
        ctx.addIssue({
          path: ['coahut'],
          code: z.ZodIssueCode.custom,
          message: 'COA dan COA Hutang tidak boleh sama',
        });
      }
    }

    const query = dbMssql('biaya').where('nama', data.nama);

    if (data.id) {
      query.whereNot('id', data.id);
    }

    if (data.jenisorder_id !== null && data.jenisorder_id !== undefined) {
      query.where('jenisorder_id', data.jenisorder_id);
    } else {
      query.whereNull('jenisorder_id');
    }

    const exists = await query.first();

    if (exists) {
      ctx.addIssue({
        path: ['nama'],
        code: z.ZodIssueCode.custom,
        message: 'Nama Biaya dengan jenis orderan ini sudah ada',
      });
    }
  });

export type UpdateBiayaDto = z.infer<typeof UpdateBiayaSchema>;
