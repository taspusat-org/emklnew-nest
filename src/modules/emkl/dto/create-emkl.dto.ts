import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';
import { zodNumberField } from 'src/utils/field-helpers';
export const CreateEmklSchema = z.object({
  // statusrelasi menyimpan id statusrelasi (varchar UUID), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
  statusrelasi: z.string().nullable().optional(),
  statusrelasi_text: z.string().nullable().optional(),

  // relasi_id menyimpan id relasi (varchar UUID), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
  relasi_id: z.string().nullable().optional(),
  relasi_id_text: z.string().nullable().optional(),
  nama: z
    .string()
    .trim()
    .refine(
      async (value) => {
        if (!value) return true;
        const exists = await isRecordExistCI('nama', value, 'emkl');
        return !exists; // Validasi jika nama sudah ada
      },
      {
        message: 'Emkl dengan nama ini sudah ada',
      },
    )
    .nullable()
    .optional(),
  contactperson: z
    .string()
    .trim()
    .max(200, { message: 'CONTACTPERSON MAKSIMAL 200 KARAKTER' })
    .nullable()
    .optional(),
  alamat: z.string().trim().nullable().optional(),
  coagiro: z
    .string()
    .trim()
    .max(100, { message: 'COAGIRO MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  coapiutang: z
    .string()
    .trim()
    .max(100, { message: 'COAPIUTANG MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  coahutang: z
    .string()
    .trim()
    .max(100, { message: 'COAHUTANG MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
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

  // statustrado menyimpan id parameter (varchar UUID), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
  statustrado: z.string().nullable().optional(),
  statustrado_text: z.string().nullable().optional(),

  // statusaktif menyimpan id parameter (varchar UUID), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
  statusaktif: z.string().nullable().optional(),
  statusaktif_text: z.string().nullable().optional(),

  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type CreateEmklDto = z.infer<typeof CreateEmklSchema>;
