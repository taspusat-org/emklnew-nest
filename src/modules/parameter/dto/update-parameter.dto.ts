import { z } from 'zod';

export const UpdateParameterSchema = z.object({
  grp: z.string().max(255).optional(),
  subgrp: z.string().max(255).optional(),
  kelompok: z.string().max(255).optional(),
  text: z.string().max(255).optional(),
  memo: z.record(z.string()).nullable().optional(),

  type: z.number().optional(),
  default: z.string().max(255).optional(),
  modifiedby: z.string().max(50).optional(),
  info: z.string().optional(),
});

export type UpdateParameterDto = z.infer<typeof UpdateParameterSchema>;
