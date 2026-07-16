// import { z } from 'zod';

// export const UpdateEmklSchema = z.object({
//   nama: z.string().trim().min(1, { message: 'Nama EMKL Wajib Diisi' }).max(255),
//   contactperson: z
//     .string()
//     .trim()
//     .min(1, { message: 'Contact Person Wajib Diisi' })
//     .max(255),
//   alamat: z.string().trim().min(1, { message: 'Alamat Wajib Diisi' }).max(255),
//   coagiro: z.string().trim().nullable().optional(),
//   coapiutang: z.string().trim().nullable().optional(),
//   coahutang: z.string().trim().nullable().optional(),
//   kota: z.string().trim().min(1, { message: 'Kota Wajib Diisi' }).max(255),
//   kodepos: z.string().trim().min(1, { message: 'Kode Pos Wajib Diisi' }).max(5),
//   notelp: z
//     .string()
//     .trim()
//     .min(1, { message: 'No Telepon Wajib Diisi' })
//     .max(14),
//   email: z.string().trim().nullable().optional(),
//   fax: z.string().trim().nullable().optional(),
//   alamatweb: z.string().trim().nullable().optional(),
//   top: z
//     .number()
//     .int({ message: 'TOP Wajib Angka' })
//     .nonnegative({ message: 'TOP Tidak Boleh Angka Negatif' }), // Ensure non-negative
//   npwp: z.string().trim().min(1, { message: 'NPWP Wajib Diisi' }).max(16),
//   namapajak: z
//     .string()
//     .trim()
//     .min(1, { message: 'Nama Pajak Wajib Diisi' })
//     .max(255),
//   alamatpajak: z
//     .string()
//     .trim()
//     .min(1, { message: 'Alamat Pajak Wajib Diisi' })
//     .max(255),
//   statustrado: z
//     .number()
//     .int({ message: 'Status Trado Wajib Angka' })
//     .nonnegative({ message: 'Status Trado Tidak Boleh Angka Negatif' }), // Ensure non-negative
//   statusaktif: z
//     .number()
//     .int({ message: 'Status Aktif Wajib Angka' })
//     .nonnegative({ message: 'Status Aktif Tidak Boleh Angka Negatif' }), // Ensure non-negative
//   modifiedby: z.string().nullable().optional(),
// });
// export type UpdateEmklDto = z.infer<typeof UpdateEmklSchema>;
