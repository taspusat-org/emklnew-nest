import { dbMssql } from 'src/common/utils/db';
import { isRecordExistCI } from 'src/utils/utils.service';
import { z } from 'zod';

const baseFields = {
  nama: z
    .string()
    .trim()
    .min(1, { message: 'Nama Jenis Biaya Marketing Wajib Diisi' })
    .max(255),
  keterangan: z.string().trim().nullable().optional(),
  statusaktif: z.string(), // Ensure non-negative
  modifiedby: z.string().nullable().optional(),
};
export const CreateJenisbiayamarketingSchema = z
  .object({
    ...baseFields,
  })
  .superRefine(async (data, ctx) => {
    // Cek unik hanya untuk create (excludeId tidak ada)
    const existsName = await isRecordExistCI(
      'nama',
      data.nama,
      'jenisbiayamarketing',
    );
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Jenis Biaya Marketing dengan nama ini sudah ada',
      });
    }
    // Validasi khusus penambahan create dapat disimpan di sini
  });
export type CreateJenisbiayamarketingDto = z.infer<
  typeof CreateJenisbiayamarketingSchema
>;

export const UpdateJenisbiayamarketingSchema = z
  .object({
    ...baseFields,
    id: z.string().optional(),
    // Field atau aturan khusus update bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    // Exclude diri sendiri dari pengecekan unik
    const existsName = await isRecordExistCI(
      'nama',
      data.nama,
      'jenisbiayamarketing',
      data.id,
    );
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Jenis Biaya Marketing dengan nama ini sudah ada',
      });
    }
    // Validasi khusus update bisa diletakkan di sini
  });
export type UpdateJenisbiayamarketingDto = z.infer<
  typeof UpdateJenisbiayamarketingSchema
>;
