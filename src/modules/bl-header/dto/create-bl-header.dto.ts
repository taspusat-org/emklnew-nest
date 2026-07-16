export class CreateBlHeaderDto {}
import { z } from 'zod';
import { isRecordExist } from 'src/utils/utils.service';

const baseFields = {
  shippinginstruction_nobukti: z
    .string({ message: 'shipping instruction nobukti WAJIB DIISI' })
    .nonempty({ message: 'shipping instruction nobukti WAJIB DIISI' }),

  tglbukti: z
    .string({ message: 'TGL BUKTI WAJIB DIISI' })
    .nonempty({ message: 'TGL BUKTI WAJIB DIISI' }),

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

const baseDetailsFields = z.object({
  id: z.number().optional(),
  nobukti: z.string().nullable().optional(),

  bl_id: z.number().nullable().optional(),

  bl_nobukti: z
    .string({ message: 'NO BL CONECTING WAJIB DIISI' })
    .nonempty({ message: 'NO BL CONECTING WAJIB DIISI' }),

  shippinginstructiondetail_nobukti: z
    .string({ message: 'SHIPPING INSTRUCTION DETAIL NO BUKTI WAJIB DIISI' })
    .nonempty({ message: 'SHIPPING INSTRUCTION DETAIL NO BUKTI WAJIB DIISI' }),

  keterangan: z.string().nullable().optional(),

  asalpelabuhan: z.string().nullable().optional(),
  consignee: z.string().nullable().optional(),
  shipper: z.string().nullable().optional(),
  comodity: z.string().nullable().optional(),
  notifyparty: z.string().nullable().optional(),
  pelayaran_nama: z.string().nullable().optional(),
  emkllain_nama: z.string().nullable().optional(),
  // details: z.array(blDetailSchema).min(1)
});

export const CreateBlSchema = z.object({
  ...baseFields,
  details: z.array(baseDetailsFields).min(1),

  // Field/aturan khusus create bisa ditambah di sini
});
export type CreateBlDto = z.infer<typeof CreateBlSchema>;

export const UpdateBlSchema = z.object({
  ...baseFields,
  details: z.array(baseDetailsFields).min(1),
  id: z.number({ required_error: 'Id wajib diisi untuk update' }),
  // Field atau aturan khusus update bisa ditambah di sini
});
export type UpdateBlDto = z.infer<typeof UpdateBlSchema>;
