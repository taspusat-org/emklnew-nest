import { dbMssql } from 'src/common/utils/db';
import { isRecordExistCI } from 'src/utils/utils.service';
import { z } from 'zod';

const baseFields = {
  nama: z.string().trim().min(1, { message: 'Nama EMKL Wajib Diisi' }).max(255),
  contactperson: z
    .string()
    .trim()
    .min(1, { message: 'Contact Person Wajib Diisi' })
    .max(255),
  alamat: z.string().trim().min(1, { message: 'Alamat Wajib Diisi' }).max(255),
  coagiro: z.string().trim().nullable().optional(),
  coapiutang: z.string().trim().nullable().optional(),
  coahutang: z.string().trim().nullable().optional(),
  kota: z.string().trim().min(1, { message: 'Kota Wajib Diisi' }).max(255),
  kodepos: z.string().trim().min(1, { message: 'Kode Pos Wajib Diisi' }).max(5),
  notelp: z
    .string()
    .trim()
    .min(1, { message: 'No Telepon Wajib Diisi' })
    .max(14),
  email: z
    .string()
    .trim()
    .email({ message: 'Email tidak valid' })
    .optional()
    .or(z.literal('')),
  fax: z.string().trim().nullable().optional(),
  alamatweb: z.string().trim().nullable().optional(),
  top: z
    .number()
    .int({ message: 'TOP Wajib Angka' })
    .nonnegative({ message: 'TOP Tidak Boleh Angka Negatif' }), // Ensure non-negative
  npwp: z.string().trim().min(1, { message: 'NPWP Wajib Diisi' }).max(20),
  namapajak: z
    .string()
    .trim()
    .min(1, { message: 'Nama Pajak Wajib Diisi' })
    .max(255),
  alamatpajak: z
    .string()
    .trim()
    .min(1, { message: 'Alamat Pajak Wajib Diisi' })
    .max(255),
  statustrado: z.string(), // Ensure non-negative
  statusaktif: z.string(), // Ensure non-negative
  modifiedby: z.string().nullable().optional(),
};
export const CreateEmklSchema = z
  .object({
    ...baseFields,
  })
  .superRefine(async (data, ctx) => {
    // Cek unik hanya untuk create (excludeId tidak ada)
    const existsName = await isRecordExistCI('nama', data.nama, 'emkl');
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Emkl dengan nama ini sudah ada',
      });
    }
    // Validasi khusus penambahan create dapat disimpan di sini
  });
export type CreateEmklDto = z.infer<typeof CreateEmklSchema>;

export const UpdateEmklSchema = z
  .object({
    ...baseFields,
    id: z.number({ required_error: 'Id wajib diisi untuk update' }),
    // Field atau aturan khusus update bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    // Exclude diri sendiri dari pengecekan unik
    const existsName = await isRecordExistCI('nama', data.nama, 'emkl', data.id);
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Emkl dengan nama ini sudah ada',
      });
    }
    // Validasi khusus update bisa diletakkan di sini
  });
export type UpdateEmklDto = z.infer<typeof UpdateEmklSchema>;
