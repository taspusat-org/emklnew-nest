import { z } from 'zod';

/**
 * Payload cetak laporan Panjar.
 *
 * Beda dengan modul master (mis. Group Biaya Extra) yang mencetak SELURUH
 * baris hasil filter: Panjar mencetak SATU bukti (header + muatan detail),
 * jadi yang dikirim adalah id baris yang dicentang di grid — bukan
 * search/filter/sort. Bentuknya sama dengan Shipping Instruction.
 */
export const ReportPanjarheaderSchema = z.object({
  mrtName: z.string().min(1, { message: 'mrtName wajib diisi' }),
  id: z
    .union([z.string(), z.number()])
    .refine(
      (value) =>
        typeof value === 'number'
          ? Number.isFinite(value) && value > 0
          : String(value).trim() !== '',
      { message: 'id wajib diisi' },
    ),
  /** Judul yang dicetak di header laporan. */
  judullaporan: z.string().optional(),
});

export type ReportPanjarheaderDto = z.infer<typeof ReportPanjarheaderSchema>;
