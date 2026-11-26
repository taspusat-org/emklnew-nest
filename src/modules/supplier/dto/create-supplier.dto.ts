import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';
import { zodDateField, zodNumberField } from 'src/utils/field-helpers';
export const CreateSupplierSchema = z.object({
  nama: z
    .string()
    .trim()
    .refine(
      async (value) => {
        if (!value) return true;
        const exists = await isRecordExistCI('nama', value, 'supplier');
        return !exists; // Validasi jika nama sudah ada
      },
      {
        message: 'Supplier dengan nama ini sudah ada',
      },
    )
    .nullable()
    .optional(),
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

  // coa menyimpan akunpusat.coa (varchar), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
  coa: z.string().nullable().optional(),
  coa_text: z.string().nullable().optional(),

  // coagiro menyimpan akunpusat.coa (varchar), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
  coagiro: z.string().nullable().optional(),
  coagiro_text: z.string().nullable().optional(),

  // coapiu menyimpan akunpusat.coa (varchar), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
  coapiu: z.string().nullable().optional(),
  coapiu_text: z.string().nullable().optional(),

  // coahut menyimpan akunpusat.coa (varchar), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
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

  // statusaktif menyimpan id parameter (varchar), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
  statusaktif: z.string().nullable().optional(),
  statusaktif_text: z.string().nullable().optional(),

  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type CreateSupplierDto = z.infer<typeof CreateSupplierSchema>;
