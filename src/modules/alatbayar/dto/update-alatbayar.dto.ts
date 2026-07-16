import { z } from 'zod';

// NOTE: uniqueness check (nama) dipindah ke service.update() supaya
// dijalankan DI DALAM transaction yg sudah pegang applock — kalau di sini
// (Zod pipe) dia query alatbayar di luar trx dan kena lock conflict dari
// row yg sedang di-UPDATE oleh request lain, sehingga pipe nyangkut ~10s
// dan request 2 tidak pernah dapat error 1222.
export const UpdateAlatbayarSchema = z.object({
  // id & status* = varchar UUID, bukan angka.
  id: z.string().optional(),
  nama: z.string().min(1, { message: 'NAMA is required' }),
  keterangan: z.string().trim().min(1, { message: 'KETERANGAN is required' }),

  statuslangsungcair: z
    .string()
    .min(1, { message: 'Status Langsung Cair is required' }),
  statuslangsungcair_text: z.string().nullable().optional(),

  statusdefault: z.string().min(1, { message: 'Status Default is required' }),
  textdefault: z.string().nullable().optional(),

  statusbank: z.string().min(1, { message: 'Status Bank is required' }),
  textbank: z.string().nullable().optional(),

  statusaktif: z.string().min(1, { message: 'Status Aktif is required' }),
  text: z.string().nullable().optional(),

  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type UpdateAlatbayarDto = z.infer<typeof UpdateAlatbayarSchema>;
