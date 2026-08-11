import { z } from 'zod';

/**
 * Payload cetak bukti Biaya Extra.
 *
 * Beda dengan laporan daftar (mis. Group Biaya Extra) yang mencetak SELURUH
 * baris hasil filter grid: LaporanBiayaExtra.mrt adalah bukti per transaksi,
 * jadi yang dikirim adalah `id` baris yang dicentang di grid, bukan filter.
 */
export const ReportBiayaExtraHeaderSchema = z.object({
  mrtName: z.string().min(1, { message: 'mrtName wajib diisi' }),
  /** id biayaextraheader yang dicetak. */
  id: z.string().min(1, { message: 'id wajib diisi' }),
  /** Judul yang dicetak di header laporan. */
  judullaporan: z.string().optional(),
});

export type ReportBiayaExtraHeaderDto = z.infer<
  typeof ReportBiayaExtraHeaderSchema
>;
