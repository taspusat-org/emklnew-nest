import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';

// ------------------------
// 1. BASE FIELDS
// ------------------------
const baseFields = {
  nama: z.string().trim().min(1, { message: 'Nama Wajib Diisi' }).max(100),
  keterangan: z.string().min(1, { message: 'Keterangan Wajib Diisi' }).max(100),
  statusaktif: z.string()
    .min(1, { message: 'Status Aktif Wajib Diisi' }),
  // modifiedby diisi di backend, optional di request body
  modifiedby: z.string().max(200).optional(),
};

// ------------------------
// 2. KHUSUS CREATE
// ------------------------
export const CreateJenisProsesFeeSchema = z
  .object({
    ...baseFields,
    // Field/aturan khusus create bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    // Cek unik hanya untuk create (excludeId tidak ada)
    const existsName = await isRecordExistCI('nama', data.nama, 'jenisprosesfee');
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Jenis Proses Fee dengan nama ini sudah ada',
      });
    }
    // Validasi khusus penambahan create dapat disimpan di sini
  });
export type CreateJenisProsesFeeDto = z.infer<
  typeof CreateJenisProsesFeeSchema
>;

// ------------------------
// 3. KHUSUS UPDATE
// ------------------------
export const UpdateJenisProsesFeeSchema = z
  .object({
    ...baseFields,
    id: z.number({ required_error: 'Id wajib diisi untuk update' }),
    // Field atau aturan khusus update bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    // Exclude diri sendiri dari pengecekan unik
    const existsName = await isRecordExistCI(
      'nama',
      data.nama,
      'jenisprosesfee',
      data.id,
    );

    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Jenis Proses Fee dengan nama ini sudah ada',
      });
    }
    // Validasi khusus update bisa diletakkan di sini
  });
export type UpdateJenisProsesFeeDto = z.infer<
  typeof UpdateJenisProsesFeeSchema
>;
