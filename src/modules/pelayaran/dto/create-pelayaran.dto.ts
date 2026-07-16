import { dbMssql } from 'src/common/utils/db';
import { isRecordExistCI } from 'src/utils/utils.service';
import { z } from 'zod';
// ------------------------
// 1. BASE FIELDS
// ------------------------
const baseFields = {
  nama: z
    .string()
    .trim()
    .min(1, { message: 'Nama Pelayaran Wajib Diisi' })
    .max(255),
  keterangan: z.string().trim().nullable().optional(),
  statusaktif: z.string(), // Ensure non-negative
  modifiedby: z.string().nullable().optional(),
};
export const CreatePelayaranSchema = z
  .object({
    ...baseFields,
  })
  .superRefine(async (data, ctx) => {
    // Cek unik hanya untuk create (excludeId tidak ada)
    const existsName = await isRecordExistCI('nama', data.nama, 'pelayaran');
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Pelayaran dengan nama ini sudah ada',
      });
    }
    // Validasi khusus penambahan create dapat disimpan di sini
  });
export type CreatePelayaranDto = z.infer<typeof CreatePelayaranSchema>;

export const UpdatePelayaranSchema = z
  .object({
    ...baseFields,
    id: z.string({ required_error: 'Id wajib diisi untuk update' }),
  })
  .superRefine(async (data, ctx) => {
    // Cek unik hanya untuk create (excludeId tidak ada)
    const existsName = await isRecordExistCI(
      'nama',
      data.nama,
      'pelayaran',
      data.id,
    );
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Pelayaran dengan nama ini sudah ada',
      });
    }
    // Validasi khusus penambahan create dapat disimpan di sini
  });
export type UpdatePelayaranDto = z.infer<typeof UpdatePelayaranSchema>;
