import { z } from 'zod';

export const CreateMenuSchema = z.object({
  title: z
    .string()
    .min(1, { message: 'Title is required and cannot be empty' })
    .trim(), // Ensure there's no extra whitespace
  // aco_id, parentId, dan statusaktif menyimpan id varchar (uuid v7), BUKAN
  // angka — kolomnya varchar(200) di tabel menus. z.number() menolak id dari
  // LookUp yang berupa string sehingga simpan selalu 400.
  aco_id: z.string().nullable().optional(),
  acos_nama: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  isActive: z.number().nullable().optional(),
  parentId: z.string().nullable().optional(),
  parent_nama: z.string().nullable().optional(),
  statusaktif: z.string().min(1, { message: 'Status Aktif Wajib Diisi' }),
  statusaktif_nama: z.string().nullable().optional(),
  order: z.number().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});
export type CreateMenuDto = z.infer<typeof CreateMenuSchema>;
