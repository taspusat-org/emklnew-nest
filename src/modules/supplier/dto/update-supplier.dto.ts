import { z } from 'zod';
import { zodDateField, zodNumberField } from 'src/utils/field-helpers';

// NOTE: uniqueness check (nama) dipindah ke service.update() supaya
// dijalankan DI DALAM transaction yg sudah pegang applock — kalau di sini
// (Zod pipe) dia query supplier di luar trx dan kena lock conflict dari
// row yg sedang di-UPDATE oleh request lain, sehingga pipe nyangkut ~10s
// dan request 2 tidak pernah dapat error 1222.
export const UpdateSupplierSchema = z.object({
  // id & relasi (lookup/status) = varchar UUID, bukan angka.
  id: z.string().optional(),
  nama: z.string().trim().nullable().optional(),
  keterangan: z.string().trim().nullable().optional(),
  contactperson: z
    .string()
    .trim()
    .max(100, { message: 'CONTACTPERSON MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  ktp: z
    .string()
    .trim()
    .max(50, { message: 'KTP MAKSIMAL 50 KARAKTER' })
    .nullable()
    .optional(),
  alamat: z.string().trim().nullable().optional(),
  coa: z.string().nullable().optional(),
  coa_text: z.string().nullable().optional(),
  coagiro: z.string().nullable().optional(),
  coagiro_text: z.string().nullable().optional(),
  coapiu: z.string().nullable().optional(),
  coapiu_text: z.string().nullable().optional(),
  coahut: z.string().nullable().optional(),
  coahut_text: z.string().nullable().optional(),
  kota: z
    .string()
    .trim()
    .max(50, { message: 'KOTA MAKSIMAL 50 KARAKTER' })
    .nullable()
    .optional(),
  kodepos: z
    .string()
    .trim()
    .max(10, { message: 'KODEPOS MAKSIMAL 10 KARAKTER' })
    .nullable()
    .optional(),
  telp: z
    .string()
    .trim()
    .max(30, { message: 'TELP MAKSIMAL 30 KARAKTER' })
    .nullable()
    .optional(),
  email: z
    .string()
    .trim()
    .max(50, { message: 'EMAIL MAKSIMAL 50 KARAKTER' })
    .nullable()
    .optional(),
  fax: z
    .string()
    .trim()
    .max(30, { message: 'FAX MAKSIMAL 30 KARAKTER' })
    .nullable()
    .optional(),
  web: z
    .string()
    .trim()
    .max(30, { message: 'WEB MAKSIMAL 30 KARAKTER' })
    .nullable()
    .optional(),
  creditterm: zodNumberField('CREDITTERM', { required: false, integer: true }),
  credittermplus: zodNumberField('CREDITTERMPLUS', {
    required: false,
    integer: true,
  }),
  npwp: z
    .string()
    .trim()
    .max(30, { message: 'NPWP MAKSIMAL 30 KARAKTER' })
    .nullable()
    .optional(),
  alamatfakturpajak: z
    .string()
    .trim()
    .max(500, { message: 'ALAMATFAKTURPAJAK MAKSIMAL 500 KARAKTER' })
    .nullable()
    .optional(),
  namapajak: z
    .string()
    .trim()
    .max(50, { message: 'NAMAPAJAK MAKSIMAL 50 KARAKTER' })
    .nullable()
    .optional(),
  nominalpph21: zodNumberField('NOMINALPPH21', { required: false }),
  nominalpph23: zodNumberField('NOMINALPPH23', { required: false }),
  noskb: z
    .string()
    .trim()
    .max(100, { message: 'NOSKB MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  tglskb: zodDateField('TGLSKB', false),
  nosk: z
    .string()
    .trim()
    .max(100, { message: 'NOSK MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  tglsk: zodDateField('TGLSK', false),
  statusaktif: z.string().nullable().optional(),
  statusaktif_text: z.string().nullable().optional(),

  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type UpdateSupplierDto = z.infer<typeof UpdateSupplierSchema>;
