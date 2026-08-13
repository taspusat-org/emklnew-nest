import { z } from 'zod';

export const UpdateHargatruckingSchema = z.object({
  tujuankapal_id: z.string().nullable().optional(),
  tujuankapal_text: z.string().nullable().optional(),

  emkl_id: z.string().min(1, { message: 'EMKL is required' }),
  emkl_text: z.string().nullable().optional(),

  container_id: z.string().min(1, { message: 'Container is required' }),
  container_text: z.string().nullable().optional(),

  jenisorder_id: z.string().min(1, { message: 'Jenis Orderan is required' }),
  jenisorder_text: z.string().nullable().optional(),

  nominal: z.string().min(1, { message: 'Nominal is required' }),
  keterangan: z.string().trim().min(1, { message: 'Keterangan is required' }),

  statusaktif: z.string().min(1, { message: 'Status aktif is required' }),
  text: z.string().nullable().optional(),

  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type UpdateHargatruckingDto = z.infer<typeof UpdateHargatruckingSchema>;
