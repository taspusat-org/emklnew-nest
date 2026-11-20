import { z } from 'zod';

/**
 * Payload export Excel SATU bukti Penerimaan beserta rinciannya (background
 * job) — cakupannya sama dengan cetak bukti, bukan daftar seluruh baris grid.
 * Karena itu yang dikirim cuma `id` baris yang dicentang, bukan filter grid.
 */
export const ExportPenerimaanheaderSchema = z.object({
  /** id penerimaanheader yang diekspor. */
  id: z.string().min(1, { message: 'id wajib diisi' }),
});

export type ExportPenerimaanheaderDto = z.infer<
  typeof ExportPenerimaanheaderSchema
>;
