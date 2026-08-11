import { z } from 'zod';

/**
 * Payload cetak bukti Pengeluaran.
 *
 * Beda dengan laporan daftar (mis. Group Biaya Extra) yang mencetak SELURUH
 * baris hasil filter grid: LaporanPengeluaran.mrt adalah bukti per transaksi —
 * satu header beserta rincian coa/nominal-nya — jadi yang dikirim adalah `id`
 * baris yang dicentang di grid, bukan filter.
 */
export const ReportPengeluaranheaderSchema = z.object({
  mrtName: z.string().min(1, { message: 'mrtName wajib diisi' }),
  /** id pengeluaranheader yang dicetak. */
  id: z.string().min(1, { message: 'id wajib diisi' }),
  /** Judul yang dicetak di header laporan. */
  judullaporan: z.string().optional(),
});

export type ReportPengeluaranheaderDto = z.infer<
  typeof ReportPengeluaranheaderSchema
>;
