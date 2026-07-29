import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';

// ------------------------
// 1. BASE FIELDS
// ------------------------
const baseFields = {
  kode: z.string().trim().min(1, { message: 'Kode Wajib Diisi' }).max(100),
  keterangan: z.string().min(1, { message: 'Keterangan Wajib Diisi' }).max(100),
  statusaktif: z.string()
    .min(1, { message: 'Status Aktif Wajib Diisi' }),
  // modifiedby diisi di backend, optional di request body
  modifiedby: z.string().max(200).optional(),
};

// ------------------------
// 2. KHUSUS CREATE
// ------------------------
export const CreateGroupInvoiceSchema = z
  .object({
    ...baseFields,
    // Field/aturan khusus create bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    // Cek unik hanya untuk create (excludeId tidak ada)
    const existsKode = await isRecordExistCI('kode', data.kode, 'groupinvoice');
    if (existsKode) {
      ctx.addIssue({
        path: ['kode'],
        code: 'custom',
        message: 'Group Invoice dengan kode ini sudah ada',
      });
    }
    // Validasi khusus penambahan create dapat disimpan di sini
  });
export type CreateGroupInvoiceDto = z.infer<
  typeof CreateGroupInvoiceSchema
>;

// ------------------------
// 3. KHUSUS UPDATE
// ------------------------
export const UpdateGroupInvoiceSchema = z
  .object({
    ...baseFields,
    id: z.string().optional(),
    // Field atau aturan khusus update bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    // Exclude diri sendiri dari pengecekan unik
    const existsKode = await isRecordExistCI(
      'kode',
      data.kode,
      'groupinvoice',
      data.id,
    );

    if (existsKode) {
      ctx.addIssue({
        path: ['kode'],
        code: 'custom',
        message: 'Group Invoice dengan kode ini sudah ada',
      });
    }
    // Validasi khusus update bisa diletakkan di sini
  });
export type UpdateGroupInvoiceDto = z.infer<
  typeof UpdateGroupInvoiceSchema
>;
