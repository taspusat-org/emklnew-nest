import { z } from 'zod';
import { isRecordExist } from 'src/utils/utils.service';
// ------------------------
// 1. BASE FIELDS
// ------------------------
const baseFields = {
  type_id: z.number().min(1, { message: 'Type Id Wajib Diisi' }),
  level: z.number().min(1, { message: 'Level harus Wajib Diisi' }),
  coa: z.string().min(1, { message: 'Keterangan Wajib Diisi' }),
  keterangancoa: z.string().min(1, { message: 'Keterangan Wajib Diisi' }),
  parent: z.string().min(1, { message: 'Keterangan Wajib Diisi' }),
  cabang_id: z
    .number()
    .int({ message: 'cabang_id harus bil bulat' })
    .min(1, { message: 'Cabang Id Wajib Diisi' }),
  statusaktif: z.string()
    .min(1, { message: 'Status Aktif Wajib Diisi' }),
  // modifiedby diisi di backend, optional di request body
  modifiedby: z.string().max(200).optional(),
};
// ------------------------
// 2. KHUSUS CREATE
// ------------------------
export const CreateAkunpusatSchema = z
  .object({
    ...baseFields,
    // Field/aturan khusus create bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    // Cek unik hanya untuk create (excludeId tidak ada)
    const existsName = await isRecordExist('coa', data.coa, 'akunpusat');
    if (existsName) {
      ctx.addIssue({
        path: ['coa'],
        code: 'custom',
        message: 'Akun Pusat dengan coa ini sudah ada',
      });
    }
    // Validasi khusus penambahan create dapat disimpan di sini
  });
export type CreateAkunpusatDto = z.infer<typeof CreateAkunpusatSchema>;
// ------------------------
// 3. KHUSUS UPDATE
// ------------------------
export const updateAkunPusatSchema = z
  .object({
    ...baseFields,
    id: z.number({ required_error: 'Id wajib diisi untuk update' }),
    // Field atau aturan khusus update bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    // Cek unik hanya untuk create (excludeId tidak ada)
    const existsName = await isRecordExist(
      'coa',
      data.coa,
      'akunpusat',
      data.id,
    );
    if (existsName) {
      ctx.addIssue({
        path: ['coa'],
        code: 'custom',
        message: 'Akun Pusat dengan coa ini sudah ada',
      });
    }
    // Validasi khusus penambahan create dapat disimpan di sini
  });
export type UpdateAkunpusatDto = z.infer<typeof updateAkunPusatSchema>;
