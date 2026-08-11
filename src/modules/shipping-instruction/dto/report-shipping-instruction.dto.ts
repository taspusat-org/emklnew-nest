import { z } from 'zod';

/**
 * Payload cetak laporan Shipping Instruction.
 *
 * Beda dengan modul master (mis. Group Biaya Extra) yang mencetak SELURUH
 * baris hasil filter: Shipping Instruction mencetak SATU dokumen, jadi yang
 * dikirim adalah id baris yang dicentang di grid — bukan search/filter/sort.
 */
export const ReportShippingInstructionSchema = z.object({
  mrtName: z.string().min(1, { message: 'mrtName wajib diisi' }),
  id: z.union([z.string(), z.number()]).refine(
    (value) =>
      typeof value === 'number'
        ? Number.isFinite(value) && value > 0
        : String(value).trim() !== '',
    { message: 'id wajib diisi' },
  ),
  /** Judul yang dicetak di header laporan. */
  judullaporan: z.string().optional(),
});

export type ReportShippingInstructionDto = z.infer<
  typeof ReportShippingInstructionSchema
>;
