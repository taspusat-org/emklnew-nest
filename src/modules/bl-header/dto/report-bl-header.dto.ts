import { z } from 'zod';

/**
 * Payload cetak laporan BL.
 *
 * Beda dengan modul master (mis. Group Biaya Extra) yang mencetak SELURUH
 * baris hasil filter: BL mencetak SATU dokumen, jadi yang dikirim adalah id
 * baris yang dicentang di grid — bukan search/filter/sort. Bentuknya sama
 * dengan Shipping Instruction.
 */
export const ReportBlHeaderSchema = z.object({
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

export type ReportBlHeaderDto = z.infer<typeof ReportBlHeaderSchema>;
