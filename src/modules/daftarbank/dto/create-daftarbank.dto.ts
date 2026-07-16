import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';
export const CreateDaftarBankSchema = z.object({
  nama: z
    .string()
    .trim()
    .min(1, { message: 'Nama Wajib Diisi' })
    .max(100)
    .refine(
      async (value) => {
        const exists = await isRecordExistCI('nama', value, 'daftarbank');
        return !exists; // Validasi jika nama sudah ada
      },
      {
        message: 'Daftar Bank dengan dengan nama ini sudah ada',
      },
    ),
  keterangan: z.string().trim().min(1, { message: 'Keterangan Wajib Diisi' }),
  statusaktif: z.string(), // Ensure non-negative
  modifiedby: z.string().nullable().optional(),
});
export type CreateDaftarBankDto = z.infer<typeof CreateDaftarBankSchema>;
