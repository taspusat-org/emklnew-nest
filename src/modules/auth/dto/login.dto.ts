import { z } from 'zod';

export const LoginSchema = z.object({
  username: z.string().min(1, { message: 'Username tidak valid' }),
  password: z.string().min(6, { message: 'Password harus minimal 6 karakter' }),
});

export type LoginDto = z.infer<typeof LoginSchema>;
