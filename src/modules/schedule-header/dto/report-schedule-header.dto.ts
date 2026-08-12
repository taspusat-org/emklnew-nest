import { z } from 'zod';

/**
 * Payload cetak bukti Schedule.
 *
 * Beda dengan laporan daftar yang mencetak SELURUH baris hasil filter grid:
 * LaporanSchedule.mrt adalah bukti per transaksi — satu header beserta
 * rincian jadwal kapalnya — jadi yang dikirim adalah `id` baris yang dicentang
 * di grid, bukan filter.
 */
export const ReportScheduleHeaderSchema = z.object({
  mrtName: z.string().min(1, { message: 'mrtName wajib diisi' }),
  /** id scheduleheader yang dicetak. */
  id: z.string().min(1, { message: 'id wajib diisi' }),
  /** Judul yang dicetak di header laporan. */
  judullaporan: z.string().optional(),
});

export type ReportScheduleHeaderDto = z.infer<
  typeof ReportScheduleHeaderSchema
>;
