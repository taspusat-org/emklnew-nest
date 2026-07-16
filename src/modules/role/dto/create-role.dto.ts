import { z } from 'zod';

export const CreateRoleSchema = z.object({
  rolename: z
    .string()
    .min(1, { message: 'Rolename is required and cannot be empty' })
    .trim(), // Ensure no extra whitespace
  // statusaktif menyimpan id parameter yang bertipe varchar (mis.
  // "02-DBCF9E01-..."), bukan integer. Validasi sebagai number membuat id
  // valid ditolak / dikonversi jadi NaN.
  statusaktif: z
    .string()
    .min(1, { message: 'statusaktif is required and cannot be empty' }),
  modifiedby: z.string().nullable().optional(),
});

export type CreateRoleDto = z.infer<typeof CreateRoleSchema>;
