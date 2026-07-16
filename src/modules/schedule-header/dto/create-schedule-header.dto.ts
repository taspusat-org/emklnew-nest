import { z } from 'zod';
import { isRecordExist } from 'src/utils/utils.service';

const baseDetails = z.object({
  id: z.number().optional(),
  nobukti: z.string().nullable().optional(),
  pelayaran_id: z.number().nullable(),
  pelayaran_nama: z.string().nullable().optional(),
  kapal_id: z.number().nullable(),
  kapal_nama: z.string().nullable().optional(),
  tujuankapal_id: z.number().nullable(),
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
  // keterangan: z.string().nullable(),
  keterangan: z.string().nonempty({ message: 'KETERANGAN WAJIB DIISI' }),
});

// ------------------------
// 1. BASE FIELDS
// ------------------------
const baseFields = {
  nobukti: z.string().nullable(),
  tglbukti: z.string().nonempty({ message: 'TGL BUKTI WAJIB DIISI' }),
  keterangan: z
    .string()
    .nonempty({ message: 'KETERANGAN WAJIB DIISI' })
    .min(1, { message: 'Keterangan Wajib Diisi' })
    .max(100),
  modifiedby: z.string().max(200).optional(),
  details: z.array(baseDetails).min(1),
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
  // id: z.number({ required_error: 'Id wajib diisi untuk update' }),
  // Field atau aturan khusus update bisa ditambah di sini
});
export type UpdateScheduleDto = z.infer<typeof UpdateScheduleSchema>;
