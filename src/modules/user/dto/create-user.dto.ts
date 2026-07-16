import { isRecordExist } from 'src/utils/utils.service';
import { z } from 'zod';

export const CreateUserSchema = z.object({
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
  statusaktif: z.string().min(1, { message: 'STATUSAKTIF is required' }),
  menu: z.string().nullable().optional(),
  karyawan_id: z.number().nullable().optional(),
  namakaryawan: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type CreateUserDto = z.infer<typeof CreateUserSchema>;
