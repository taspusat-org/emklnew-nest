import { z } from 'zod';

export const ForgetPasswordSchema = z.object({
  token: z.string().min(1, { message: 'Token is required' }),
  newPassword: z.string().min(8, { message: 'newPassword tidak valid' }),
});

export type ForgetPasswordDto = z.infer<typeof ForgetPasswordSchema>;
