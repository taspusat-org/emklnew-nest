import { z } from 'zod';
import { zodNumberField } from 'src/utils/field-helpers';

// NOTE: uniqueness check (nama) dipindah ke service.update() supaya
// dijalankan DI DALAM transaction yg sudah pegang applock — kalau di sini
// (Zod pipe) dia query emkl di luar trx dan kena lock conflict dari
// row yg sedang di-UPDATE oleh request lain, sehingga pipe nyangkut ~10s
// dan request 2 tidak pernah dapat error 1222.
export const UpdateEmklSchema = z.object({
  // id & relasi (lookup/status) = varchar UUID, bukan angka.
  id: z.string().optional(),
  statusrelasi: z.string().nullable().optional(),
  statusrelasi_text: z.string().nullable().optional(),
  relasi_id: z.string().nullable().optional(),
  relasi_id_text: z.string().nullable().optional(),
  nama: z.string().trim().nullable().optional(),
  contactperson: z
    .string()
    .trim()
    .max(200, { message: 'CONTACTPERSON MAKSIMAL 200 KARAKTER' })
    .nullable()
    .optional(),
  alamat: z.string().trim().nullable().optional(),
  coagiro: z.string().nullable().optional(),
  coagiro_text: z.string().nullable().optional(),
  coapiutang: z.string().nullable().optional(),
  coapiutang_text: z.string().nullable().optional(),
  coahutang: z.string().nullable().optional(),
  coahutang_text: z.string().nullable().optional(),
  kota: z
    .string()
    .trim()
    .max(200, { message: 'KOTA MAKSIMAL 200 KARAKTER' })
    .nullable()
    .optional(),
  kodepos: z
    .string()
    .trim()
    .max(100, { message: 'KODEPOS MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  notelp: z
    .string()
    .trim()
    .max(100, { message: 'NOTELP MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  email: z
    .string()
    .trim()
    .max(200, { message: 'EMAIL MAKSIMAL 200 KARAKTER' })
    .nullable()
    .optional(),
  fax: z
    .string()
    .trim()
    .max(100, { message: 'FAX MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  alamatweb: z
    .string()
    .trim()
    .max(200, { message: 'ALAMATWEB MAKSIMAL 200 KARAKTER' })
    .nullable()
    .optional(),
  top: zodNumberField('TOP', { required: false }),
  npwp: z
    .string()
    .trim()
    .max(100, { message: 'NPWP MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  namapajak: z.string().trim().nullable().optional(),
  alamatpajak: z.string().trim().nullable().optional(),
  statustrado: z.string().nullable().optional(),
  statustrado_text: z.string().nullable().optional(),
  statusaktif: z.string().nullable().optional(),
  statusaktif_text: z.string().nullable().optional(),

  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type UpdateEmklDto = z.infer<typeof UpdateEmklSchema>;
