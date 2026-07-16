import { z } from 'zod';

export const CreateMasterbiayaSchema = z.object({
  // *_id menyimpan id varchar(200) (FK), bukan angka. Jangan z.number() —
  // frontend mengirim id string sehingga z.number() menolaknya.
  tujuankapal_id: z.string().nullable().optional(),
  tujuankapal_text: z.string().nullable().optional(),

  sandarkapal_id: z.string().nullable().optional(),
  sandarkapal_text: z.string().nullable().optional(),

  pelayaran_id: z.string().nullable().optional(),
  pelayaran_text: z.string().nullable().optional(),

  container_id: z.string().nullable().optional(),
  container_text: z.string().nullable().optional(),

  biayaemkl_id: z.string().nullable().optional(),
  biayaemkl_text: z.string().nullable().optional(),

  jenisorder_id: z.string().nullable().optional(),
  jenisorderan_text: z.string().nullable().optional(),

  tglberlaku: z
    .string()
    .trim()
    .min(1, { message: 'Tanggal Berlaku is required' }),

  nominal: z.string().trim().min(1, { message: 'Nominal is required' }),

  statusaktif: z.string().min(1, { message: 'STATUSAKTIF is required' }),
  text: z.string().nullable().optional(),

  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type CreateMasterBiayaDto = z.infer<typeof CreateMasterbiayaSchema>;
