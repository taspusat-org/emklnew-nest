import { z } from 'zod';

export const CreateParameterSchema = z.object({
  grp: z.string().trim().min(1, { message: 'grp Wajib Diisi' }).max(255),
  subgrp: z.string().max(255).nullable().optional(),
  kelompok: z.string().max(255).nullable().optional(),
  text: z.string().trim().min(1, { message: 'text Wajib Diisi' }).max(255),
  memo: z.record(z.string()).nullable().optional(),
  // Kolom `type` di tabel parameter bertipe nvarchar(100), bukan angka —
  // schema lama (z.number()) menolak nilai yang dikirim form.
  type: z.string().max(100).nullable().optional(),
  default: z.string().max(255).nullable().optional(),
  modifiedby: z.string().max(50).nullable().optional(),
  info: z.string().nullable().optional(),
});

export type CreateParameterDto = z.infer<typeof CreateParameterSchema>;
