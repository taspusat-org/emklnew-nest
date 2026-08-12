import { z } from 'zod';

// id header, id detail, dan seluruh FK (pelayaran/kapal/tujuankapal) adalah
// varchar(200) berisi UUID — bukan angka. Union string|number dipertahankan
// karena grid mengirim 0 untuk baris detail yang baru.
const idField = z.union([z.string(), z.number()]);

const requiredLookup = (label: string) =>
  idField
    .nullable()
    .refine(
      (value) => value !== null && value !== '' && String(value) !== '0',
      { message: `${label} WAJIB DIISI` },
    );

const baseDetails = z.object({
  id: idField.optional(),
  nobukti: z.string().nullable().optional(),
  pelayaran_id: requiredLookup('PELAYARAN'),
  pelayaran_nama: z.string().nullable().optional(),
  kapal_id: requiredLookup('KAPAL'),
  kapal_nama: z.string().nullable().optional(),
  tujuankapal_id: requiredLookup('TUJUAN KAPAL'),
  tujuankapal_nama: z.string().nullable().optional(),
  tglberangkat: z.string().nullable(),
  tgltiba: z.string().nullable(),
  etb: z.string().nullable(),
  eta: z.string().nullable(),
  etd: z.string().nullable(),
  voyberangkat: z.string().nullable(),
  voytiba: z.string().nullable(),
  closing: z.string().nullable(),
  etatujuan: z.string().nullable(),
  etdtujuan: z.string().nullable(),
  keterangan: z.string().nonempty({ message: 'KETERANGAN WAJIB DIISI' }),
});

// ------------------------
// 1. BASE FIELDS
// ------------------------
const baseFields = {
  nobukti: z.string().nullable().optional(),
  tglbukti: z.string().nonempty({ message: 'TGL BUKTI WAJIB DIISI' }),
  keterangan: z
    .string()
    .nonempty({ message: 'KETERANGAN WAJIB DIISI' })
    .max(100),
  modifiedby: z.string().max(200).optional(),
  details: z.array(baseDetails).min(1, { message: 'DETAIL WAJIB DIISI' }),
};

// ------------------------
// 2. KHUSUS CREATE
// ------------------------
export const CreateScheduleSchema = z.object({
  ...baseFields,
  // Field/aturan khusus create bisa ditambah di sini
});
export type CreateScheduleDto = z.infer<typeof CreateScheduleSchema>;

// ------------------------
// 3. KHUSUS UPDATE
// ------------------------
export const UpdateScheduleSchema = z.object({
  ...baseFields,
  // Field atau aturan khusus update bisa ditambah di sini
});
export type UpdateScheduleDto = z.infer<typeof UpdateScheduleSchema>;
