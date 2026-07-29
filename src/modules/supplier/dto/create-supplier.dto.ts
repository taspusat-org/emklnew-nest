import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';

// ------------------------
// 1. BASE FIELDS
// ------------------------
const baseFields = {
  nama: z.string().trim().min(1, { message: 'Nama Wajib Diisi' }),
  keterangan: z
    .string({ message: 'Keterangan Wajib Diisi' })
    .nonempty({ message: 'Keterangan Wajib Diisi' }),
  contactperson: z
    .string({ message: 'Contact Person Wajib Diisi' })
    .min(1, { message: 'Contact Person Wajib Diisi' })
    .max(100),
  ktp: z
    .string({ message: 'KTP Wajib Diisi' })
    .min(16, { message: 'KTP HARUS TERDIRI DARI 16 DIGIT' })
    .max(50),
  alamat: z
    .string({ message: 'alamat Wajib Diisi' })
    .min(1, { message: 'alamat Wajib Diisi' })
    .max(100),

  coa: z
    .string({ message: 'coa Wajib Diisi' })
    .min(1, { message: 'coa Wajib Diisi' }),
  coa_nama: z.string().nullable().optional(),

  coapiu: z
    .string({ message: 'coa piutang Wajib Diisi' })
    .min(1, { message: 'coa piutang Wajib Diisi' }),
  coapiu_nama: z.string().nullable().optional(),

  coahut: z
    .string({ message: 'coa hutang Wajib Diisi' })
    .min(1, { message: 'coa hutang Wajib Diisi' }),
  coahut_nama: z.string().nullable().optional(),

  coagiro: z
    .string({ message: 'coa giro Wajib Diisi' })
    .min(1, { message: 'coa giro Wajib Diisi' }),
  coagiro_nama: z.string().nullable().optional(),

  kota: z.string().nullable().optional(),
  kodepos: z.string().nullable().optional(),
  telp: z.string().nullable().optional(),

  email: z
    .string({ message: 'email Wajib Diisi' })
    .min(1, { message: 'email Wajib Diisi' })
    .email({ message: 'Email must be a valid email address' })
    .max(50),

  fax: z.string().nullable().optional(),
  web: z.string().nullable().optional(),

  creditterm: z
    .number({ message: 'Credit Term Wajib Diisi' })
    .min(1, { message: 'Credit Term Wajib Diisi' }),

  credittermplus: z.number().nullable().optional(),

  npwp: z
    .string({ message: 'npwp Wajib Diisi' })
    .min(1, { message: 'npwp Wajib Diisi' })
    .regex(/^\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}$/, {
      message: 'Format NPWP tidak valid (contoh: 12.345.678.9-012.345)',
    })
    .max(30),

  alamatfakturpajak: z
    .string({ message: 'alamat faktur pajak Wajib Diisi' })
    .min(1, { message: 'alamat faktur pajak Wajib Diisi' })
    .max(500),

  namapajak: z
    .string({ message: 'nama pajak Wajib Diisi' })
    .min(1, { message: 'nama pajak Wajib Diisi' })
    .max(50),

  nominalpph21: z.string().nullable().optional(),
  nominalpph23: z.string().nullable().optional(),
  noskb: z.string().nullable().optional(),
  tglskb: z.string().nullable().optional(),
  nosk: z.string().nullable().optional(),
  tglsk: z.string().nullable().optional(),

  statusaktif: z.string()
    .min(1, { message: 'Status Aktif Wajib Diisi' }),
  statusaktif_nama: z.string().nullable().optional(),
  modifiedby: z.string().max(200).optional(),
};

// ------------------------
// 2. KHUSUS CREATE
// ------------------------
export const CreateSupplierSchema = z
  .object({
    ...baseFields,
    // Field/aturan khusus create bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    const existsName = await isRecordExistCI('nama', data.nama, 'supplier');
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Supplier dengan nama ini sudah ada',
      });
    }

    const coaValues = [
      { field: 'coa', value: data.coa, name: 'COA' },
      { field: 'coapiu', value: data.coapiu, name: 'COA Piutang' },
      { field: 'coahut', value: data.coahut, name: 'COA Hutang' },
      { field: 'coagiro', value: data.coagiro, name: 'COA Giro' },
    ];

    for (let i = 0; i < coaValues.length; i++) {
      for (let j = i + 1; j < coaValues.length; j++) {
        const first = coaValues[i];
        const second = coaValues[j];

        if (
          first.value != null &&
          second.value != null &&
          first.value === second.value
        ) {
          ctx.addIssue({
            path: [second.field as keyof typeof data],
            code: z.ZodIssueCode.custom,
            message: `${first.name} dan ${second.name} tidak boleh sama`,
          });
        }
      }
    }
    // Validasi khusus penambahan create dapat disimpan di sini
  });
export type CreateSupplierDto = z.infer<typeof CreateSupplierSchema>;

// ------------------------
// 3. KHUSUS UPDATE
// ------------------------
export const UpdateSupplierSchema = z
  .object({
    ...baseFields,
    id: z.string().optional(),
    // Field atau aturan khusus update bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    // Exclude diri sendiri dari pengecekan unik
    const existsName = await isRecordExistCI(
      'nama',
      data.nama,
      'supplier',
      data.id,
    );
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Supplier dengan nama ini sudah ada',
      });
    }

    const coaValues = [
      { field: 'coa', value: data.coa, name: 'COA' },
      { field: 'coapiu', value: data.coapiu, name: 'COA Piutang' },
      { field: 'coahut', value: data.coahut, name: 'COA Hutang' },
      { field: 'coagiro', value: data.coagiro, name: 'COA Giro' },
    ];

    for (let i = 0; i < coaValues.length; i++) {
      for (let j = i + 1; j < coaValues.length; j++) {
        const first = coaValues[i];
        const second = coaValues[j];

        if (
          first.value != null &&
          second.value != null &&
          first.value === second.value
        ) {
          ctx.addIssue({
            path: [second.field as keyof typeof data],
            code: z.ZodIssueCode.custom,
            message: `${first.name} dan ${second.name} tidak boleh sama`,
          });
        }
      }
    }
    // Validasi khusus update bisa diletakkan di sini
  });
export type UpdateSupplierDto = z.infer<typeof UpdateSupplierSchema>;
