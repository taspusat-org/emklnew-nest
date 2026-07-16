import { isRecordExistCI } from 'src/utils/utils.service';
import { z } from 'zod';

export const CreateGroupbiayaextraSchema = z.object({
  keterangan: z
    .string()
    .trim()
    .min(1, { message: 'keterangan Wajib Diisi' })
    .max(100)
    .refine(
      async (value) => {
        const exists = await isRecordExistCI(
          'keterangan',
          value,
          'groupbiayaextra',
        );
        return !exists; // Validasi jika keterangan sudah ada
      },
      {
        message: 'Group Biaya Extra dengan Keterangan ini sudah ada',
      },
    ),
  statusaktif: z.string()
    .min(0, { message: 'statusaktif must be a non-negative integer' }),
  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type CreateGroupbiayaextraDto = z.infer<
  typeof CreateGroupbiayaextraSchema
>;
