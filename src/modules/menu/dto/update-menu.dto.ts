import { z } from 'zod';

export const UpdateMenuSchema = z.object({
  id: z.string().optional(),
  title: z
    .string()
    .min(1, { message: 'Title is required and cannot be empty' })
    .trim()
    .optional(), // Make title optional for update
  // Sama seperti create: id relasi berupa varchar (uuid v7), bukan angka.
  aco_id: z.string().nullable().optional(),
  acos_nama: z.string().nullable().optional(),
  icon: z.string().nullable().optional(), // Optional
  isActive: z.number().nullable().optional(), // Optional
  parentId: z.string().nullable().optional(), // Optional
  parent_nama: z.string().nullable().optional(),
  statusaktif: z
    .string()
    .min(1, { message: 'Status Aktif Wajib Diisi' })
    .optional(), // Optional
  statusaktif_nama: z.string().nullable().optional(),
  order: z.number().nullable().optional(), // Optional
  modifiedby: z.string().nullable().optional(), // Optional, you might pass the current user here
});
export type UpdateMenuDto = z.infer<typeof UpdateMenuSchema>;
