import { isRecordExistCI } from 'src/utils/utils.service';
import { z } from 'zod';

// export const CreateMarketingSchema2 = z.object({
//   nama: z
//     .string()
//     .nonempty({ message: 'Nama wajib diisi' })
//     .refine(
//       async (value) => {
//         const exists = await isRecordExistCI('nama', value, 'marketing');
//         return !exists; // Validasi jika nama sudah ada
//       },
//       {
//         message: `Marketing dengan dengan nama ini sudah ada`,
//       },
//     ),
//   keterangan: z.string().nonempty({ message: 'Keterangan Wajib Diisi' }),
//   statusaktif: z
//     .number()
//     .int({ message: 'Status Aktif Wajib Diisi' })
//     .min(1, { message: 'Status Aktif Wajib Diisi' }),
//   statusaktif_nama: z.string().nullable().optional(),
//   email: z
//     .string()
//     .nonempty({ message: 'Email wajib diisi' })
//     .email({ message: 'email must be a valid email address' }),
//   karyawan_id: z.number().min(1, { message: 'Karyawan Wajib Diisi' }),
//   karyawan_nama: z.string().nullable().optional(),
//   tglmasuk: z
//     .string({
//       required_error: 'Tgl Masuk Wajib Diisi',
//       invalid_type_error: 'Tgl Masuk Wajib Diisi',
//     })
//     .nonempty({ message: 'Tgl Masuk Wajib Diisi' }),
//   statustarget: z.string().nullable(),
//   statustarget_nama: z.string().nullable().optional(),
//   statusbagifee: z.string().nullable(),
//   statusbagifee_nama: z.string().nullable().optional(),
//   statusfeemanager: z.string().nullable(),
//   statusfeemanager_nama: z.string().nullable().optional(),
//   marketinggroup_id: z.number().nullable(),
//   marketinggroup_nama: z.string().nullable().optional(),
//   statusprafee: z.string().nullable(),
//   statusprafee_nama: z.string().nullable().optional(),
//   modifiedby: z.string().nullable().optional(),
// });

// export type CreateMarketingDto2 = z.infer<typeof CreateMarketingSchema>;

// ------------------------
// 1. BASE FIELDS
// ------------------------
const baseFields = {
  nama: z.string().trim().min(1, { message: 'Nama Wajib Diisi' }).max(100),
  keterangan: z.string().min(1, { message: 'Keterangan Wajib Diisi' }).max(100),
  statusaktif: z.string()
    .min(1, { message: 'Status Aktif Wajib Diisi' }),
  email: z
    .string()
    .nonempty({ message: 'Email wajib diisi' })
    .email({ message: 'email must be a valid email address' }),
  // boleh kosong; service menormalkan '' → null agar tidak melanggar
  // FK_marketing_karyawan_id_karyawan
  karyawan_id: z.string().nullable().optional(),
  tglmasuk: z
    .string({
      required_error: 'Tgl Masuk Wajib Diisi',
      invalid_type_error: 'Tgl Masuk Wajib Diisi',
    })
    .nonempty({ message: 'Tgl Masuk Wajib Diisi' }),
  statustarget: z.string().nullable(),
  statusbagifee: z.string().nullable(),
  statusfeemanager: z.string().nullable(),
  // `.optional()` WAJIB, bukan cuma `.nullable()`: field ini boleh kosong dan
  // form TIDAK menyertakan key-nya sama sekali kalau tak pernah dipilih —
  // z.string().nullable() menolak `undefined` dengan "Required" → 400.
  marketinggroup_id: z.string().nullable().optional(),
  statusprafee: z.string().nullable(),
  // modifiedby diisi di backend, optional di request body
  modifiedby: z.string().max(200).optional(),
};
// ------------------------
// 2. KHUSUS CREATE
// ------------------------
export const CreateMarketingSchema = z
  .object({
    ...baseFields,
    // Field/aturan khusus create bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    const existsName = await isRecordExistCI('nama', data.nama, 'marketing');
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Marketing dengan nama ini sudah ada',
      });
    }
    // Validasi khusus penambahan create dapat disimpan di sini
  });
export type CreateMarketingDto = z.infer<typeof CreateMarketingSchema>;

// ------------------------
// 3. KHUSUS UPDATE
// ------------------------
export const UpdateMarketingSchema = z.object({
  ...baseFields,
  // id: z.number({ required_error: 'Id wajib diisi untuk update' }),
  // Field atau aturan khusus update bisa ditambah di sini
});
// .superRefine(async (data, ctx) => {
//   const existsName = await isRecordExist(
//     'nama',
//     data.nama,
//     'typeakuntansi',
//     data.id,
//   );
//   if (existsName) {
//     ctx.addIssue({
//       path: ['nama'],
//       code: 'custom',
//       message: 'Type Akuntansi dengan nama ini sudah ada',
//     });
//   }
//   // Validasi khusus update bisa diletakkan di sini
// });
export type UpdateMarketingDto = z.infer<typeof UpdateMarketingSchema>;
