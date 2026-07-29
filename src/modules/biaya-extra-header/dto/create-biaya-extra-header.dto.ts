import { z } from 'zod';
import { isRecordExist } from 'src/utils/utils.service';

const baseFields = {
  tglbukti: z
    .string({ message: 'TGL BUKTI WAJIB DIISI' })
    .nonempty({ message: 'TGL BUKTI WAJIB DIISI' }),

  jenisorder_id: z
    .string({
      required_error: 'JENIS ORDER WAJIB DIISI',
    })
    .min(1, { message: 'JENIS ORDER WAJIB DIISI' }),
  jenisorder_nama: z.string().nullable().optional(),

  biayaemkl_id: z
    .string({
      required_error: 'BIAYA EMKL WAJIB DIISI',
    })
    .min(1, { message: 'BIAYA EMKL WAJIB DIISI' }),
  biayaemkl_nama: z.string().nullable().optional(),

  keterangan: z
    .string({ message: 'VOY BERANGKAT WAJIB DIISI' })
    .nonempty({ message: 'VOY BERANGKAT WAJIB DIISI' }),

  modifiedby: z.string().max(200).optional(),
};

const baseDetailsFields = z.object({
  id: z.string().optional(),
  nobukti: z.string().nullable().optional(),
  biayaextra_id: z.string().nullable().optional(),

  orderanmuatan_id: z.string().nullable().optional(),
  orderanmuatan_nobukti: z
    .string({ message: 'ORDERAN MUATAN WAJIB DIISI' })
    .nonempty({ message: 'ORDERAN MUATAN WAJIB DIISI' }),

  estimasi: z
    .string({ message: 'ESTIMASI WAJIB DIISI' })
    .nonempty({ message: 'ESTIMASI WAJIB DIISI' }),

  // nominal: z
  //   .string({ message: 'NOMINAL WAJIB DIISI' })
  //   .nonempty({ message: 'NOMINAL WAJIB DIISI' }),

  statustagih: z.string()
    .min(1, { message: 'BIAYA EMKL WAJIB DIISI' }),
  statustagih_nama: z.string().nullable().optional(),

  nominaltagih: z
    .string({ message: 'NOMINAL TAGIH WAJIB DIISI' })
    .nonempty({ message: 'NOMINAL TAGIH WAJIB DIISI' }),

  keterangan: z.string().nullable().optional(),

  groupbiayaextra_id: z
    .string({
      required_error: 'BIAYA EMKL WAJIB DIISI',
    })
    .min(1, { message: 'BIAYA EMKL WAJIB DIISI' }),
  groupbiayaextra_nama: z.string().nullable().optional(),
});

export const CreateBiayaExtraHeaderSchema = z.object({
  ...baseFields,
  details: z.array(baseDetailsFields).min(1),

  // Field/aturan khusus create bisa ditambah di sini
});
export type CreateBiayaExtraHeaderDto = z.infer<
  typeof CreateBiayaExtraHeaderSchema
>;

export const UpdateBiayaExtraHeaderSchema = z.object({
  ...baseFields,
  details: z.array(baseDetailsFields).min(1),
  id: z.string({ required_error: 'Id wajib diisi untuk update' }),
  // Field atau aturan khusus update bisa ditambah di sini
});
export type UpdateBiayaExtraHeaderDto = z.infer<
  typeof UpdateBiayaExtraHeaderSchema
>;
