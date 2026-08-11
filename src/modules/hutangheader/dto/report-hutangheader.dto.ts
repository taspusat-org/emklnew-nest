import { z } from 'zod';

/**
 * Payload cetak bukti Hutang.
 *
 * Beda dengan laporan daftar (mis. Group Biaya Extra) yang mencetak SELURUH
 * baris hasil filter grid: LaporanHutang.mrt adalah bukti per transaksi —
 * satu header beserta rincian coa/nominal-nya — jadi yang dikirim adalah `id`
 * baris yang dicentang di grid, bukan filter.
 */
export const ReportHutangheaderSchema = z.object({
  mrtName: z.string().min(1, { message: 'mrtName wajib diisi' }),
  /** id hutangheader yang dicetak. */
  id: z.string().min(1, { message: 'id wajib diisi' }),
  /** Judul yang dicetak di header laporan. */
  judullaporan: z.string().optional(),
});

export type ReportHutangheaderDto = z.infer<typeof ReportHutangheaderSchema>;
