import { z } from 'zod';

/**
 * Payload cetak bukti Pengembalian Kas Gantung.
 *
 * Beda dengan laporan daftar (mis. Group Biaya Extra) yang mencetak SELURUH
 * baris hasil filter grid: LaporanPengembalianKasGantung.mrt adalah bukti per
 * transaksi — satu header beserta rincian kas gantung/nominalnya — jadi yang
 * dikirim adalah `id` baris yang dicentang di grid, bukan filter.
 */
export const ReportPengembaliankasgantungheaderSchema = z.object({
  mrtName: z.string().min(1, { message: 'mrtName wajib diisi' }),
  /** id pengembaliankasgantungheader yang dicetak. */
  id: z.string().min(1, { message: 'id wajib diisi' }),
  /** Judul yang dicetak di header laporan. */
  judullaporan: z.string().optional(),
});

export type ReportPengembaliankasgantungheaderDto = z.infer<
  typeof ReportPengembaliankasgantungheaderSchema
>;
