import { z } from 'zod';
import { CreatePenerimaanheaderSchema } from './create-penerimaanheader.dto';

/**
 * Aturan update sama dengan create: bank & tanggal bukti tetap wajib karena
 * jurnalnya dirakit ulang dari kedua nilai itu pada setiap simpan.
 */
export const UpdatePenerimaanheaderSchema = CreatePenerimaanheaderSchema;
export type UpdatePenerimaanheaderDto = z.infer<
  typeof UpdatePenerimaanheaderSchema
>;
