import { z } from 'zod';

export const CreateRelasiSchema = z.object({
  statusrelasi: z.string(),
  nama: z.string().trim().min(1, { message: 'Nama Wajib Diisi' }),
  coagiro: z.string().nullable().optional(),
  coapiutang: z.string().nullable().optional(),
  coahutang: z.string().nullable().optional(),
  statustitip: z.string()
    .nullable()
    .optional(),
  titipcabang_id: z
    .string()
    .nullable()
    .optional(),
  alamat: z.string().nullable().optional(),
  npwp: z.string().nullable().optional(),
  namapajak: z.string().nullable().optional(),
  alamatpajak: z.string().nullable().optional(),
  statusaktif: z.string()
    .nullable()
    .optional(),
  modifiedby: z.string().nullable().optional(),
});
export type CreateRelasiDto = z.infer<typeof CreateRelasiSchema>;
