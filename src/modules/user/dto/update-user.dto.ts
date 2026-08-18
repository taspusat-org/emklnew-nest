import { isRecordExistCI } from 'src/utils/utils.service';
import { z } from 'zod';

export const UpdateUserSchema = z
  .object({
    id: z.string().optional(),
    username: z
      .string()
      .trim()
      .min(1, { message: 'Username Wajib Diisi' })
      .max(255),
    name: z.string().trim().min(1, { message: 'Nama Wajib Diisi' }).max(255),
    email: z.string().nullable().optional(),
    password: z
      .string()
      .min(6, { message: 'Password must be at least 6 characters' })
      .max(255)
      .optional(),
    statusaktif: z.string().min(1, { message: 'Status Aktif Wajib Diisi' }),
    menu: z.string().nullable().optional(),
    karyawan_id: z.string().nullable().optional(),
    namakaryawan: z.string().nullable().optional(),
    userId: z.string().nullable().optional(),
    modifiedby: z.string().nullable().optional(),
  })
  .superRefine(async (data, ctx) => {
    const existsUsername = await isRecordExistCI(
      'username',
      data.username,
      'users',
      data.id ?? undefined,
    );
    if (existsUsername) {
      ctx.addIssue({
        path: ['username'],
        code: 'custom',
        message: 'User dengan Username ini sudah ada',
      });
    }
  });

export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;
