import { z } from 'zod';

/**
 * Payload cetak bukti Penerimaan.
 *
 * Beda dengan laporan daftar yang mencetak SELURUH baris hasil filter grid:
 * LaporanPenerimaan.mrt adalah bukti per transaksi — satu header beserta
 * rincian coa/nominal-nya — jadi yang dikirim adalah `id` baris yang dicentang
 * di grid, bukan filter.
 */
export const ReportPenerimaanheaderSchema = z.object({
  mrtName: z.string().min(1, { message: 'mrtName wajib diisi' }),
  /** id penerimaanheader yang dicetak. */
  id: z.string().min(1, { message: 'id wajib diisi' }),
  /** Judul yang dicetak di header laporan. */
  judullaporan: z.string().optional(),
});

export type ReportPenerimaanheaderDto = z.infer<
  typeof ReportPenerimaanheaderSchema
>;
