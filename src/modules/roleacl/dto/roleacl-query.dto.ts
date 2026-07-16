import { z } from 'zod';

export const RoleAclQueryDto = z.object({
  id: z.number().int().positive(), // Ensure the id is a positive integer
});

export type RoleAclQueryDtoType = z.infer<typeof RoleAclQueryDto>;
