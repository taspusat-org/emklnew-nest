import { z } from 'zod';

export const RegisterSchema = z.object({
  email: z.string().email({ message: 'Email tidak valid' }),
  password: z.string().min(6, { message: 'Password harus minimal 6 karakter' }),
  name: z.string().min(1, { message: 'Nama tidak boleh kosong' }),
  username: z.string().min(1, { message: 'Username tidak boleh kosong' }), // Disesuaikan dengan field yang ada
  // Remove 'age' field since it's not in the DB schema.
});

export type RegisterDto = z.infer<typeof RegisterSchema>;
