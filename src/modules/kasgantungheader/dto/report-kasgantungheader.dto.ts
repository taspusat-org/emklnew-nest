import { z } from 'zod';

/**
 * Payload cetak bukti Kas Gantung.
 *
 * Bentuknya sama dengan Jurnal Umum: LaporanKasGantung.mrt adalah bukti PER
 * TRANSAKSI — satu header beserta rincian nominalnya — jadi yang dikirim
 * frontend adalah `id` baris yang dicentang di grid, bukan filter grid.
 */
export const ReportKasgantungheaderSchema = z.object({
  mrtName: z.string().min(1, { message: 'mrtName wajib diisi' }),
  /** id kasgantungheader yang dicetak. */
  id: z.string().min(1, { message: 'id wajib diisi' }),
  /** Judul yang dicetak di header laporan. */
  judullaporan: z.string().optional(),
});

export type ReportKasgantungheaderDto = z.infer<
  typeof ReportKasgantungheaderSchema
>;
