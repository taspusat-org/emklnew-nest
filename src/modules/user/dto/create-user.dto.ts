import { isRecordExistCI } from 'src/utils/utils.service';
import { z } from 'zod';

export const CreateUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, { message: 'Username Wajib Diisi' })
    .max(255)
    .refine(
      async (value) => {
        const exists = await isRecordExistCI('username', value, 'users');
        return !exists; // Validasi jika username sudah ada
      },
      {
        message: 'User dengan Username ini sudah ada',
      },
    ),
  name: z.string().trim().min(1, { message: 'Nama Wajib Diisi' }).max(255),
  email: z.string().nullable().optional(),
  password: z
    .string()
    .min(6, { message: 'Password must be at least 6 characters' })
    .max(255)
    .optional(),
  statusaktif: z.string().min(1, { message: 'Status Aktif Wajib Diisi' }),
  menu: z.string().nullable().optional(),
  // karyawan.id kini uuid v7 (varchar), bukan auto-increment — z.number()
  // membuat payload dari lookup karyawan selalu ditolak validasi.
  karyawan_id: z.string().nullable().optional(),
  namakaryawan: z.string().nullable().optional(),
  /** User asal yang hak aksesnya (role + acl) disalin ke user baru. */
  userId: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type CreateUserDto = z.infer<typeof CreateUserSchema>;
