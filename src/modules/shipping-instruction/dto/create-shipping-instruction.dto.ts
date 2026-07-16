import { z } from 'zod';
import { isRecordExist } from 'src/utils/utils.service';

const baseFields = {
  schedule_id: z
    .number({
      required_error: 'SCHEDULE WAJIB DIISI',
    })
    .min(1, { message: 'SCHEDULE WAJIB DIISI' }),

  voyberangkat: z
    .string({ message: 'VOY BERANGKAT WAJIB DIISI' })
    .nonempty({ message: 'VOY BERANGKAT WAJIB DIISI' }),

  kapal_id: z
    .number({
      required_error: 'KAPAL WAJIB DIISI',
    })
    .min(1, { message: 'KAPAL WAJIB DIISI' }),
  kapal_nama: z.string().nullable().optional(),

  tglberangkat: z
    .string({ message: 'TGL BERANGKAT WAJIB DIISI' })
    .nonempty({ message: 'TGL BERANGKAT WAJIB DIISI' }),

  tujuankapal_id: z
    .number({
      required_error: 'TUJUAN WAJIB DIISI',
    })
    .min(1, { message: 'TUJUAN WAJIB DIISI' }),
  tujuankapal_nama: z.string().nullable().optional(),

  modifiedby: z.string().max(200).optional(),
};

export const CreateShippingInstructionSchema = z.object({
  ...baseFields,
  // details: z.array(shippingInstructionDetailSchema).min(1),

  // Field/aturan khusus create bisa ditambah di sini
});
export type CreateShippingInstructionDto = z.infer<
  typeof CreateShippingInstructionSchema
>;

export const UpdateShippingInstructionSchema = z.object({
  ...baseFields,
  // id: z.number({ required_error: 'Id wajib diisi untuk update' }),
  // Field atau aturan khusus update bisa ditambah di sini
});
export type UpdateShippingInstructionDto = z.infer<
  typeof UpdateShippingInstructionSchema
>;
