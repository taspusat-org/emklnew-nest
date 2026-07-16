import { z } from 'zod';
import { isRecordExist } from 'src/utils/utils.service';

const baseFields = {
  tglbukti: z
    .string({ message: 'TGL BUKTI WAJIB DIISI' })
    .nonempty({ message: 'TGL BUKTI WAJIB DIISI' }),

  jenisorder_id: z
    .number({
      required_error: 'JENIS ORDER WAJIB DIISI',
    })
    .min(1, { message: 'JENIS ORDER WAJIB DIISI' }),
  jenisorder_nama: z.string().nullable().optional(),

  biayaemkl_id: z
    .number({
      required_error: 'BIAYA EMKL WAJIB DIISI',
    })
    .min(1, { message: 'BIAYA EMKL WAJIB DIISI' }),
  biayaemkl_nama: z.string().nullable().optional(),

  keterangan: z
    .string({ message: 'KETERANGAN WAJIB DIISI' })
    .nonempty({ message: 'KETERANGAN WAJIB DIISI' }),

  modifiedby: z.string().max(200).optional(),
};

const baseDetailsFields = z.object({
  id: z.number().optional(),
  nobukti: z.string().nullable().optional(),
  panjar_id: z.number().nullable().optional(),

  orderanmuatan_id: z.number().nullable().optional(),
  orderanmuatan_nobukti: z
    .string({ message: 'ORDERAN MUATAN WAJIB DIISI' })
    .nonempty({ message: 'ORDERAN MUATAN WAJIB DIISI' }),

  estimasi: z
    .string({ message: 'ESTIMASI WAJIB DIISI' })
    .nonempty({ message: 'ESTIMASI WAJIB DIISI' }),

  nominal: z
    .string({ message: 'NOMINAL WAJIB DIISI' })
    .nonempty({ message: 'NOMINAL WAJIB DIISI' }),

  keterangan: z.string().nullable().optional(),
});

export const CreatePanjarHeaderSchema = z.object({
  ...baseFields,
  details: z.array(baseDetailsFields).min(1),

  // Field/aturan khusus create bisa ditambah di sini
});
export type CreatePanjarheaderDto = z.infer<typeof CreatePanjarHeaderSchema>;

export const UpdatePanjarHeaderSchema = z.object({
  ...baseFields,
  details: z.array(baseDetailsFields).min(1),
  id: z.number({ required_error: 'Id wajib diisi untuk update' }),
  // Field atau aturan khusus update bisa ditambah di sini
});
export type UpdatePanjarheaderDto = z.infer<typeof UpdatePanjarHeaderSchema>;
