import { z } from 'zod';

export const CreateScheduleKapalSchema = z.object({
  jenisorder_id: z.number().nullable().optional(),
  keterangan: z.string().nullable().optional(),
  kapal_id: z.number().nullable().optional(),
  pelayaran_id: z.number().nullable().optional(),
  tujuankapal_id: z.number().nullable().optional(),
  asalkapal_id: z.number().nullable().optional(),
  tglberangkat: z.string().nullable().optional(),
  tgltiba: z.string().nullable().optional(),
  tglclosing: z.string().nullable().optional(),
  statusberangkatkapal: z.string().nullable().optional(),
  statustibakapal: z.string().nullable().optional(),
  batasmuatankapal: z.string().nullable().optional(),
  statusaktif: z.string().nullable().optional(),
  modifiedby: z.string().max(200).optional(),
});

export type CreateScheduleKapalDto = z.infer<typeof CreateScheduleKapalSchema>;
