import { z } from 'zod';

export const UpdateRoleSchema = z.object({
  rolename: z
    .string()
    .min(1, { message: 'Rolename is required and cannot be empty' })
    .trim()
    .optional(), // Make it optional for update
  // statusaktif menyimpan id parameter bertipe varchar, bukan integer.
  statusaktif: z
    .string()
    .min(1, { message: 'statusaktif is required and cannot be empty' })
    .optional(), // Make it optional for update
  modifiedby: z.string().nullable().optional(), // Optional, as it could be set automatically
});

export type UpdateRoleDto = z.infer<typeof UpdateRoleSchema>;
