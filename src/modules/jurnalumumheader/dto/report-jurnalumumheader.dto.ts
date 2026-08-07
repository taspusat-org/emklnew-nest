import { z } from 'zod';

/**
 * Payload cetak bukti Jurnal Umum.
 *
 * Beda dengan laporan daftar (mis. Group Biaya Extra) yang mencetak SELURUH
 * baris hasil filter grid: LaporanJurnalUmum.mrt adalah bukti per transaksi —
 * satu header beserta rincian coa/nominalnya — jadi yang dikirim adalah `id`
 * baris yang dicentang di grid, bukan filter.
 */
export const ReportJurnalumumheaderSchema = z.object({
  mrtName: z.string().min(1, { message: 'mrtName wajib diisi' }),
  /** id jurnalumumheader yang dicetak. */
  id: z.string().min(1, { message: 'id wajib diisi' }),
  /** Judul yang dicetak di header laporan. */
  judullaporan: z.string().optional(),
});

export type ReportJurnalumumheaderDto = z.infer<
  typeof ReportJurnalumumheaderSchema
>;
