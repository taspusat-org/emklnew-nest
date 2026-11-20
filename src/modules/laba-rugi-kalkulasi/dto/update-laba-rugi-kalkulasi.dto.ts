import { isRecordExist } from 'src/utils/utils.service';
import { z } from 'zod';

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

  statusfinalkomisimarketing: z
    .string()
    .min(1, { message: 'STATUS FINAL KOMISI MARKETING WAJIB DIISI' }),
  statusfinalkomisimarketing_text: z.string().nullable().optional(),

  statusfinalbonustriwulan: z
    .string()
    .min(1, { message: 'STATUS FINAL BONUS TRIWULAN WAJIB DIISI' }),
  statusfinalbonustriwulan_text: z.string().nullable().optional(),

  modifiedby: z.string().max(200).optional(),
};

// MASIH ADA MASALAH DISINI, JADI KALAU DIA UPDATE DATA NYA TANPA MENGUBAH PERIODE BAKALAN KENA VALIDASI
export const UpdateLabaRugiKalkulasiSchema = z
  .object({
    ...baseFields,
    id: z.string().optional(),
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
      console.log('sadfasdf', data);
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
