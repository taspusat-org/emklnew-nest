import { z } from 'zod';

/**
 * Payload cetak bukti Pindah Buku.
 *
 * Sama seperti Jurnal Umum dan Kas Gantung: LaporanPindahBuku.mrt adalah bukti
 * PER TRANSAKSI, jadi yang dikirim adalah `id` baris yang dicentang di grid,
 * bukan filter daftar.
 */
export const ReportPindahBukuSchema = z.object({
  mrtName: z.string().min(1, { message: 'mrtName wajib diisi' }),
  /** id pindahbuku yang dicetak. */
  id: z.union([z.string(), z.number()]).transform((value) => String(value)),
  /** Judul yang dicetak di header laporan. */
  judullaporan: z.string().optional(),
});

export type ReportPindahBukuDto = z.infer<typeof ReportPindahBukuSchema>;
