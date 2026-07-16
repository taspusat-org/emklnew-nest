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

  orderan_id: z.number().nullable().optional(),
  orderan_nobukti: z
    .string({ message: 'NO BUKTI ORDERAN WAJIB DIISI' })
    .nonempty({ message: 'NO BUKTI ORDERAN WAJIB DIISI' }),

  nominal: z
    .string({ message: 'NOMINAL WAJIB DIISI' })
    .nonempty({ message: 'NOMINAL WAJIB DIISI' }),

  shipper_id: z
    .number({
      required_error: 'SHIPPER WAJIB DIISI',
    })
    .min(1, { message: 'SHIPPER WAJIB DIISI' }),
  shipper_nama: z.string().nullable().optional(),

  statusppn: z.string()
    .min(1, { message: 'STATUS PPN WAJIB DIISI' }),
  statusppn_nama: z.string().nullable().optional(),

  asuransi_id: z
    .number({
      required_error: 'ASURANSI WAJIB DIISI',
    })
    .min(1, { message: 'ASURANSI WAJIB DIISI' }),
  asuransi_nama: z.string().nullable().optional(),

  comodity_id: z.number().nullable().optional(),
  comodity_nama: z.string().nullable().optional(),

  consignee_id: z.number().nullable().optional(),
  consignee_nama: z.string().nullable().optional(),

  modifiedby: z.string().max(200).optional(),
};

const baseDetailsBiayaFields = z.object({
  id: z.number().optional(),
  nobukti: z.string().nullable().optional(),
  estimasibiaya_id: z.number().nullable().optional(),

  link_id: z.number().nullable().optional(),
  link_nama: z.string().nullable().optional(),

  biayaemkl_id: z.number().nullable().optional(),
  biayaemkl_nama: z.string().nullable().optional(),

  nominal: z.string().nullable().optional(),
  nilaiasuransi: z.string().nullable().optional(),
  nominaldisc: z.string().nullable().optional(),
  nominalsebelumdisc: z.string().nullable().optional(),
  nominaltradoluar: z.string().nullable().optional(),
});

const baseDetailsInvoiceFields = z.object({
  id: z.number().optional(),
  nobukti: z.string().nullable().optional(),
  estimasibiaya_id: z.number().nullable().optional(),

  link_id: z.number().nullable().optional(),
  link_nama: z.string().nullable().optional(),

  biayaemkl_id: z.number().nullable().optional(),
  biayaemkl_nama: z.string().nullable().optional(),

  nominal: z.string().nullable().optional(),
});

export const CreateEstimasiBiayaHeaderSchema = z.object({
  ...baseFields,
  detailsbiaya: z.array(baseDetailsBiayaFields).min(1),
  detailsinvoice: z.array(baseDetailsInvoiceFields).min(1),
  // Field/aturan khusus create bisa ditambah di sini
});
export type CreateEstimasiBiayaHeaderDto = z.infer<
  typeof CreateEstimasiBiayaHeaderSchema
>;

export const UpdateEstimasiBiayaHeaderSchema = z.object({
  ...baseFields,
  id: z.number({ required_error: 'Id wajib diisi untuk update' }),
  detailsbiaya: z.array(baseDetailsBiayaFields).min(1),
  detailsinvoice: z.array(baseDetailsInvoiceFields).min(1),
  // Field atau aturan khusus update bisa ditambah di sini
});
export type UpdateEstimasiBiayaHeaderDto = z.infer<
  typeof UpdateEstimasiBiayaHeaderSchema
>;
