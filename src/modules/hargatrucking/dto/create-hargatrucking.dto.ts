import { z } from 'zod';

export const CreateHargatruckingSchema = z.object({
  tarifdetail_id: z.string().nullable().optional(),
  tarifdetail_text: z.string().nullable().optional(),

  tujuankapal_id: z.string().min(1, { message: 'Tujuan Kapal is required' }),
  tujuankapal_text: z.string().nullable().optional(),

  emkl_id: z.string().min(1, { message: 'EMKL is required' }),
  emkl_text: z.string().nullable().optional(),

  keterangan: z.string().trim().nullable().optional(),

  container_id: z.string().min(1, { message: 'Container is required' }),
  container_text: z.string().nullable().optional(),

  jenisorder_id: z.string().min(1, { message: 'Jenis Orderan is required' }),
  jenisorder_text: z.string().nullable().optional(),

  nominal: z.string().min(1, { message: 'Nominal is required' }),

  statusaktif: z.string().min(1, { message: 'status aktif is required' }),
  statusaktif_text: z.string().nullable().optional(),

  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type CreateHargatruckingDto = z.infer<typeof CreateHargatruckingSchema>;
