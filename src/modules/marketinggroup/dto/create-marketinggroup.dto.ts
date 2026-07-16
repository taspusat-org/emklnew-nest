import { dbMssql } from 'src/common/utils/db';
import { isRecordExist } from 'src/utils/utils.service';
import { z } from 'zod';

const baseFields = {
  marketing_id: z.number().int({ message: 'Marketing Wajib Diisi' }),
  statusaktif: z.string(), // Ensure non-negative
  modifiedby: z.string().nullable().optional(),
};
export const CreateMarketinggroupSchema = z
  .object({
    ...baseFields,
  })
  .superRefine(async (data, ctx) => {
    // Cek unik hanya untuk create (excludeId tidak ada)
    const existsName = await isRecordExist(
      'marketing_id',
      data.marketing_id,
      'marketinggroup',
    );
    if (existsName) {
      ctx.addIssue({
        path: ['marketing_nama'],
        code: 'custom',
        message: 'Marketing Group dengan nama ini sudah ada',
      });
    }
    // Validasi khusus penambahan create dapat disimpan di sini
  });
export type CreateMarketinggroupDto = z.infer<
  typeof CreateMarketinggroupSchema
>;

export const UpdateMarketinggroupSchema = z
  .object({
    ...baseFields,
    id: z.number({ required_error: 'Id wajib diisi untuk update' }),
    // Field atau aturan khusus update bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    // Exclude diri sendiri dari pengecekan unik
    const existsName = await isRecordExist(
      'marketing_id',
      data.marketing_id,
      'marketinggroup',
      data.id,
    );
    if (existsName) {
      ctx.addIssue({
        path: ['marketing_nama'],
        code: 'custom',
        message: 'Marketing Group dengan nama ini sudah ada',
      });
    }
    // Validasi khusus update bisa diletakkan di sini
  });
export type UpdateMarketinggroupDto = z.infer<
  typeof UpdateMarketinggroupSchema
>;
