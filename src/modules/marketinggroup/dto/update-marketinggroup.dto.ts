// import { z } from 'zod';
// export const UpdateMarketinggroupSchema = z.object({
//   marketing_id: z.number().int({ message: 'Marketing Wajib Diisi' }),
//   statusaktif: z
//     .number()
//     .int({ message: 'Status Aktif Wajib Angka' })
//     .nonnegative({ message: 'Status Aktif Tidak Boleh Angka Negatif' }), // Ensure non-negative
//   modifiedby: z.string().nullable().optional(),
// });
// export type UpdateMarketinggroupDto = z.infer<
//   typeof UpdateMarketinggroupSchema
// >;
