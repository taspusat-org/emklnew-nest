import { optional, z } from 'zod';

export const UpdateUserroleSchema = z.object({
  roleIds: z.array(z.string()).nullable().optional(), // Ensure that roleIds is a non-empty array of numbers
  modifiedby: z.string().nullable().optional(),
});

export type UpdateUserroleDto = z.infer<typeof UpdateUserroleSchema>;
