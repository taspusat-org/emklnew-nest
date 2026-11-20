import { z } from 'zod';

// NOTE: uniqueness check (nama) dipindah ke service.update() supaya
// dijalankan DI DALAM transaction yg sudah pegang applock — kalau di sini
// (Zod pipe) dia query jabatan di luar trx dan kena lock conflict dari
// row yg sedang di-UPDATE oleh request lain, sehingga pipe nyangkut ~10s
// dan request 2 tidak pernah dapat error 1222.
export const UpdateJabatanSchema = z.object({
  // id & relasi (lookup/status) = varchar UUID, bukan angka.
  id: z.string().optional(),
  nama: z
    .string()
    .trim()
    .min(1, { message: 'NAMA WAJIB DIISI' })
    .max(100, { message: 'NAMA MAKSIMAL 100 KARAKTER' }),
  keterangan: z.string().trim().nullable().optional(),
  statusaktif: z.string().min(1, { message: 'STATUS AKTIF WAJIB DIISI' }),
  statusaktif_text: z.string().nullable().optional(),
  divisi_id: z.string().min(1, { message: 'DIVISI WAJIB DIISI' }),
  divisi_id_text: z.string().nullable().optional(),

  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type UpdateJabatanDto = z.infer<typeof UpdateJabatanSchema>;
