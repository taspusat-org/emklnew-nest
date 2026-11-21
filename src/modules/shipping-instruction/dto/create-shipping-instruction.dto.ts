import { z } from 'zod';
import { isRecordExist } from 'src/utils/utils.service';

const baseFields = {
  schedule_id: z
    .string({
      required_error: 'SCHEDULE WAJIB DIISI',
    })
    .min(1, { message: 'SCHEDULE WAJIB DIISI' }),

  voyberangkat: z
    .string({ message: 'VOY BERANGKAT WAJIB DIISI' })
    .nonempty({ message: 'VOY BERANGKAT WAJIB DIISI' }),

  kapal_id: z
    .string({
      required_error: 'KAPAL WAJIB DIISI',
    })
    .min(1, { message: 'KAPAL WAJIB DIISI' }),
  kapal_nama: z.string().nullable().optional(),

  tglberangkat: z
    .string({ message: 'TGL BERANGKAT WAJIB DIISI' })
    .nonempty({ message: 'TGL BERANGKAT WAJIB DIISI' }),

  tujuankapal_id: z
    .string({
      required_error: 'TUJUAN WAJIB DIISI',
    })
    .min(1, { message: 'TUJUAN WAJIB DIISI' }),
  tujuankapal_nama: z.string().nullable().optional(),

  modifiedby: z.string().max(200).optional(),
};

const mixedId = z.union([z.string(), z.number()]).nullable().optional();

const baseRincianFields = z.object({
  id: mixedId,
  idOrderan: mixedId,

  orderanmuatan_nobukti: z
    .string({ message: 'JOB WAJIB DIISI' })
    .nonempty({ message: 'JOB WAJIB DIISI' }),

  comodity: z.string().nullable().optional(),
  keterangan: z.string().nullable().optional(),
});

const baseDetailsFields = z.object({
  id: mixedId,
  orderan_id: mixedId,
  daftarbl_id: mixedId,
  containerpelayaran_id: mixedId,
  emkl_id: mixedId,
  tujuankapal_id: mixedId,

  shippinginstructiondetail_nobukti: z.string().nullable().optional(),
  asalpelabuhan: z.string().nullable().optional(),
  keterangan: z.string().nullable().optional(),
  consignee: z.string().nullable().optional(),
  shipper: z.string().nullable().optional(),
  comodity: z.string().nullable().optional(),
  notifyparty: z.string().nullable().optional(),
  totalgw: z.string().nullable().optional(),

  detailsrincian: z
    .array(baseRincianFields, {
      required_error: 'JOB WAJIB DIISI',
      invalid_type_error: 'JOB WAJIB DIISI',
    })
    .min(1, { message: 'JOB WAJIB DIISI' }),
});

export const CreateShippingInstructionSchema = z.object({
  ...baseFields,
  details: z
    .array(baseDetailsFields, {
      required_error: 'DETAIL SHIPPING INSTRUCTION WAJIB DIISI',
      invalid_type_error: 'DETAIL SHIPPING INSTRUCTION WAJIB DIISI',
    })
    .min(1, { message: 'DETAIL SHIPPING INSTRUCTION WAJIB DIISI' }),

  // Field/aturan khusus create bisa ditambah di sini
});
export type CreateShippingInstructionDto = z.infer<
  typeof CreateShippingInstructionSchema
>;

export const UpdateShippingInstructionSchema = z.object({
  ...baseFields,
  details: z
    .array(baseDetailsFields, {
      required_error: 'DETAIL SHIPPING INSTRUCTION WAJIB DIISI',
      invalid_type_error: 'DETAIL SHIPPING INSTRUCTION WAJIB DIISI',
    })
    .min(1, { message: 'DETAIL SHIPPING INSTRUCTION WAJIB DIISI' }),
  // id: z.number({ required_error: 'Id wajib diisi untuk update' }),
  // Field atau aturan khusus update bisa ditambah di sini
});
export type UpdateShippingInstructionDto = z.infer<
  typeof UpdateShippingInstructionSchema
>;
