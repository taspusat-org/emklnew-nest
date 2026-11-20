import { z } from 'zod';

// NOTE: uniqueness check (nama) dipindah ke service.update() supaya
// dijalankan DI DALAM transaction yg sudah pegang applock — kalau di sini
// (Zod pipe) dia query pelayaran di luar trx dan kena lock conflict dari
// row yg sedang di-UPDATE oleh request lain, sehingga pipe nyangkut ~10s
// dan request 2 tidak pernah dapat error 1222.
export const UpdatePelayaranSchema = z.object({
  // id & relasi (lookup/status) = varchar UUID, bukan angka.
  id: z.string().optional(),
  relasi_id: z.string().nullable().optional(),
  relasi_id_text: z.string().nullable().optional(),
  nama: z.string().trim().nullable().optional(),
  keterangan: z.string().trim().nullable().optional(),
  statusaktif: z.string().nullable().optional(),
  statusaktif_text: z.string().nullable().optional(),

  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type UpdatePelayaranDto = z.infer<typeof UpdatePelayaranSchema>;
