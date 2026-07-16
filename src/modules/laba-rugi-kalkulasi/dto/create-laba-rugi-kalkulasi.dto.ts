import { z } from 'zod';
import { isRecordExist } from 'src/utils/utils.service';

// ------------------------
// 1. BASE FIELDS
// ------------------------
const baseFields = {
  periode: z.string().nonempty({ message: 'PERIODE WAJIB DIISI' }),

  estkomisimarketing: z.string().nullable().optional(),
  komisimarketing: z.string().nullable().optional(),
  biayakantorpusat: z.string().nullable().optional(),
  biayatour: z.string().nullable().optional(),
  gajidireksi: z.string().nullable().optional(),
  estkomisikacab: z.string().nullable().optional(),
  biayabonustriwulan: z.string().nullable().optional(),
  estkomisimarketing2: z.string().nullable().optional(),
  estkomisikacabcabang1: z.string().nullable().optional(),
  estkomisikacabcabang2: z.string().nullable().optional(),

  statusfinalkomisimarketing: z.string()
    .min(1, { message: 'STATUS FINAL KOMISI MARKETING WAJIB DIISI' }),
  statusfinalkomisi_nama: z.string().nullable().optional(),

  statusfinalbonustriwulan: z.string()
    .min(1, { message: 'STATUS FINAL KOMISI MARKETING WAJIB DIISI' }),
  statusfinalbonus_nama: z.string().nullable().optional(),

  // modifiedby diisi di backend, optional di request body
  modifiedby: z.string().max(200).optional(),
};

// ------------------------
// 2. KHUSUS CREATE
// ------------------------
export const CreateLabaRugiKalkulasiSchema = z
  .object({
    ...baseFields,
    // Field/aturan khusus create bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    // Cek unik hanya untuk create (excludeId tidak ada)
    const existsPeriode = await isRecordExist(
      'periode',
      data.periode,
      'labarugikalkulasi',
    );

    if (existsPeriode) {
      ctx.addIssue({
        path: ['periode'],
        code: 'custom',
        message: `Laba Rugi Kalkulasi dengan periode ${data.periode} sudah ada`,
      });
    }
    // Validasi khusus penambahan create dapat disimpan di sini
  });
export type CreateLabaRugiKalkulasiDto = z.infer<
  typeof CreateLabaRugiKalkulasiSchema
>;

// ------------------------
// 3. KHUSUS UPDATE
// ------------------------
export const UpdateLabaRugiKalkulasiSchema = z
  .object({
    ...baseFields,
    id: z.number({ required_error: 'Id wajib diisi untuk update' }),
    // Field atau aturan khusus update bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    // Exclude diri sendiri dari pengecekan unik
    const existsPeriode = await isRecordExist(
      'periode',
      data.periode,
      'labarugikalkulasi',
      data.id,
    );
    if (existsPeriode) {
      ctx.addIssue({
        path: ['periode'],
        code: 'custom',
        message: `Laba Rugi Kalkulasi dengan periode ${data.periode} sudah ada`,
      });
    }
    // Validasi khusus update bisa diletakkan di sini
  });
export type UpdateLabaRugiKalkulasiDto = z.infer<
  typeof UpdateLabaRugiKalkulasiSchema
>;
