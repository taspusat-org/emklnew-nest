import { z } from 'zod';

export const UpdateUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, { message: 'Username is required' })
    .max(255),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  password: z
    .string()
    .min(6, { message: 'Password must be at least 6 characters' })
    .max(255)
    .optional(),
  statusaktif: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;
