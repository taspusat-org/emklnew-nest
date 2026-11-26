import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';
import { zodDateField, zodNumberField } from 'src/utils/field-helpers';
export const CreateShipperSchema = z.object({
  nama: z
    .string()
    .trim()
    .max(8000, { message: 'NAMA MAKSIMAL 8000 KARAKTER' })
    .refine(
      async (value) => {
        if (!value) return true;
        const exists = await isRecordExistCI('nama', value, 'shipper');
        return !exists; // Validasi jika nama sudah ada
      },
      {
        message: 'Shipper  dengan nama ini sudah ada',
      },
    )
    .nullable()
    .optional(),
  keterangan: z
    .string()
    .trim()
    .max(8000, { message: 'KETERANGAN MAKSIMAL 8000 KARAKTER' })
    .nullable()
    .optional(),
  contactperson: z
    .string()
    .trim()
    .max(100, { message: 'CONTACTPERSON MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  alamat: z
    .string()
    .trim()
    .max(250, { message: 'ALAMAT MAKSIMAL 250 KARAKTER' })
    .nullable()
    .optional(),
  coa: z.string().nullable().optional(),
  coa_text: z.string().nullable().optional(),
  coapiutang: z.string().nullable().optional(),
  coapiutang_text: z.string().nullable().optional(),
  coahutang: z.string().nullable().optional(),
  coahutang_text: z.string().nullable().optional(),
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
    .max(1000, { message: 'EMAIL MAKSIMAL 1000 KARAKTER' })
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
  creditlimit: zodNumberField('CREDITLIMIT', { required: false }),
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
  coagiro: z.string().nullable().optional(),
  coagiro_text: z.string().nullable().optional(),
  ppn: zodNumberField('PPN', { required: false }),
  titipke: z
    .string()
    .trim()
    .max(30, { message: 'TITIPKE MAKSIMAL 30 KARAKTER' })
    .nullable()
    .optional(),
  ppnbatalmuat: zodNumberField('PPNBATALMUAT', { required: false }),
  grup: z
    .string()
    .trim()
    .max(100, { message: 'GRUP MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  formatdeliveryreport: zodNumberField('FORMATDELIVERYREPORT', {
    required: false,
    integer: true,
  }),
  comodity: z
    .string()
    .trim()
    .max(100, { message: 'COMODITY MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  namashippercetak: z
    .string()
    .trim()
    .max(100, { message: 'NAMASHIPPERCETAK MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  formatcetak: zodNumberField('FORMATCETAK', {
    required: false,
    integer: true,
  }),

  // marketing_id menyimpan id marketing (varchar UUID), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
  marketing_id: z.string().nullable().optional(),
  marketing_id_text: z.string().nullable().optional(),
  blok: z
    .string()
    .trim()
    .max(100, { message: 'BLOK MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  nomor: z
    .string()
    .trim()
    .max(100, { message: 'NOMOR MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  rt: z
    .string()
    .trim()
    .max(100, { message: 'RT MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  rw: z
    .string()
    .trim()
    .max(100, { message: 'RW MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  kelurahan: z
    .string()
    .trim()
    .max(100, { message: 'KELURAHAN MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  kabupaten: z
    .string()
    .trim()
    .max(100, { message: 'KABUPATEN MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  kecamatan: z
    .string()
    .trim()
    .max(100, { message: 'KECAMATAN MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  propinsi: z
    .string()
    .trim()
    .max(100, { message: 'PROPINSI MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  isdpp10psn: zodNumberField('ISDPP10PSN', { required: false }),
  usertracing: z
    .string()
    .trim()
    .max(50, { message: 'USERTRACING MAKSIMAL 50 KARAKTER' })
    .nullable()
    .optional(),
  passwordtracing: z
    .string()
    .trim()
    .max(50, { message: 'PASSWORDTRACING MAKSIMAL 50 KARAKTER' })
    .nullable()
    .optional(),
  kodeprospek: z
    .string()
    .trim()
    .max(50, { message: 'KODEPROSPEK MAKSIMAL 50 KARAKTER' })
    .nullable()
    .optional(),
  namashipperprospek: z
    .string()
    .trim()
    .max(200, { message: 'NAMASHIPPERPROSPEK MAKSIMAL 200 KARAKTER' })
    .nullable()
    .optional(),
  emaildelay: z
    .string()
    .trim()
    .max(1000, { message: 'EMAILDELAY MAKSIMAL 1000 KARAKTER' })
    .nullable()
    .optional(),
  keterangan1barisinvoice: z
    .string()
    .trim()
    .max(100, { message: 'KETERANGAN1BARISINVOICE MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  nik: z
    .string()
    .trim()
    .max(30, { message: 'NIK MAKSIMAL 30 KARAKTER' })
    .nullable()
    .optional(),
  namaparaf: z
    .string()
    .trim()
    .max(100, { message: 'NAMAPARAF MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  saldopiutang: zodNumberField('SALDOPIUTANG', { required: false }),
  keteranganshipperjobminus: z
    .string()
    .trim()
    .max(500, { message: 'KETERANGANSHIPPERJOBMINUS MAKSIMAL 500 KARAKTER' })
    .nullable()
    .optional(),
  tglemailshipperjobminus: zodDateField('TGLEMAILSHIPPERJOBMINUS', false),
  tgllahir: zodDateField('TGLLAHIR', false),

  // idshipperasal menyimpan id shipper (varchar UUID), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
  idshipperasal: z.string().nullable().optional(),
  idshipperasal_text: z.string().nullable().optional(),
  initial: z
    .string()
    .trim()
    .max(100, { message: 'INITIAL MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  tipe: z
    .string()
    .trim()
    .max(100, { message: 'TIPE MAKSIMAL 100 KARAKTER' })
    .nullable()
    .optional(),
  idtipe: zodNumberField('IDTIPE', { required: false, integer: true }),
  idinitial: zodNumberField('IDINITIAL', { required: false, integer: true }),
  nshipperprospek: z
    .string()
    .trim()
    .max(500, { message: 'NSHIPPERPROSPEK MAKSIMAL 500 KARAKTER' })
    .nullable()
    .optional(),

  // parentshipper_id menyimpan id shipper (varchar UUID), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
  parentshipper_id: z.string().nullable().optional(),
  parentshipper_id_text: z.string().nullable().optional(),
  npwpnik: z
    .string()
    .trim()
    .max(16, { message: 'NPWPNIK MAKSIMAL 16 KARAKTER' })
    .nullable()
    .optional(),
  nitku: z
    .string()
    .trim()
    .max(22, { message: 'NITKU MAKSIMAL 22 KARAKTER' })
    .nullable()
    .optional(),
  kodepajak: z
    .string()
    .trim()
    .max(10, { message: 'KODEPAJAK MAKSIMAL 10 KARAKTER' })
    .nullable()
    .optional(),

  // statusaktif menyimpan id parameter (varchar UUID), bukan angka. Jangan z.number()
  // — frontend mengirim id string sehingga z.number() menolaknya.
  statusaktif: z.string().nullable().optional(),
  statusaktif_text: z.string().nullable().optional(),

  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type CreateShipperDto = z.infer<typeof CreateShipperSchema>;
