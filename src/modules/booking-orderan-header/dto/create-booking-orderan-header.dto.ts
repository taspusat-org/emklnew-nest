import { z } from 'zod';
import { isRecordExist } from 'src/utils/utils.service';

// ------------------------
// 1. BASE FIELDS
// ------------------------
const baseFields = {
  nobukti: z.string().nullable(),

  tglbukti: z
    .string({ message: 'TGL BUKTI WAJIB DIISI' })
    .nonempty({ message: 'TGL BUKTI WAJIB DIISI' }),

  jenisorder_id: z
    .number()
    .int({ message: 'JENIS ORDER WAJIB DIISI' })
    .min(1, { message: 'JENIS ORDER WAJIB DIISI' }),
  jenisorder_nama: z.string().nullable().optional(),

  container_id: z
    .number({
      required_error: 'CONTAINER WAJIB DIISI',
    })
    .min(1, { message: 'CONTAINER WAJIB DIISI' }),
  container_nama: z.string().nullable().optional(),

  shipper_id: z
    .number({
      required_error: 'SHIPPER WAJIB DIISI',
    })
    .min(1, { message: 'SHIPPER WAJIB DIISI' }),
  shipper_nama: z.string().nullable().optional(),

  tujuankapal_id: z
    .number({
      required_error: 'TUJUAN KAPAL WAJIB DIISI',
    })
    .min(1, { message: 'TUJUAN KAPAL WAJIB DIISI' }),
  tujuankapal_nama: z.string().nullable().optional(),

  marketing_id: z
    .number({
      required_error: 'MARKETING WAJIB DIISI',
    })
    .min(1, { message: 'MARKETING WAJIB DIISI' }),
  marketing_nama: z.string().nullable().optional(),

  // keterangan: z
  //   .string({ message: 'KETERANGAN WAJIB DIISI' })
  //   .min(1, { message: 'KETERANGAN WAJIB DIISI' }),

  schedule_id: z.number().nullable().optional(),
  schedule_nama: z.string().nullable().optional(),

  pelayarancontainer_id: z.number().nullable().optional(),
  pelayarancontainer_nama: z.string().nullable().optional(),

  // jenismuatan_id: z
  //   .number({
  //     required_error: 'JENIS MUATAN WAJIB DIISI'
  //   })
  //   .min(1, { message: 'JENIS MUATAN WAJIB DIISI' }),
  // jenismuatan_nama: z.string().nullable().optional(),

  // sandarkapal_id: z
  //   .number({
  //     required_error: 'SANDAR KAPAL WAJIB DIISI'
  //   })
  //   .min(1, { message: 'SANDAR KAPAL WAJIB DIISI' }),
  // sandarkapal_nama: z.string().nullable().optional(),

  tradoluar: z.number().nullable().optional(),
  tradoluar_nama: z.string().nullable().optional(),

  nopolisi: z.string().nullable().optional(),
  nosp: z.string().nullable().optional(),
  nocontainer: z.string().nullable().optional(),
  noseal: z.string().nullable().optional(),

  lokasistuffing: z.number().nullable().optional(),
  lokasistuffing_nama: z.string().nullable().optional(),

  nominalstuffing: z.string().nullable().optional(),

  emkllain_id: z.number().nullable().optional(),
  emkllain_nama: z.string().nullable().optional(),

  asalmuatan: z.string().nullable().optional(),

  daftarbl_id: z.number().nullable().optional(),
  daftarbl_nama: z.string().nullable().optional(),

  comodity: z.string().nullable().optional(),
  gandengan: z.string().nullable().optional(),

  pisahbl: z.number().nullable().optional(),
  pisahbl_nama: z.string().nullable().optional(),

  jobptd: z.number().nullable().optional(),
  jobptd_nama: z.string().nullable().optional(),

  transit: z.number().nullable().optional(),
  transit_nama: z.string().nullable().optional(),

  stuffingdepo: z.number().nullable().optional(),
  stuffingdepo_nama: z.string().nullable().optional(),

  opendoor: z.number().nullable().optional(),
  opendoor_nama: z.string().nullable().optional(),

  batalmuat: z.number().nullable().optional(),
  batalmuat_nama: z.string().nullable().optional(),

  soc: z.number().nullable().optional(),
  soc_nama: z.string().nullable().optional(),

  pengurusandoorekspedisilain: z.number().nullable().optional(),
  pengurusandoorekspedisilain_nama: z.string().nullable().optional(),

  // modifiedby diisi di backend, optional di request body
  modifiedby: z.string().max(200).optional(),
};

// ------------------------
// 2. KHUSUS CREATE
// ------------------------
export const CreateBookingOrderanHeaderSchema = z
  .object({
    ...baseFields,
    // Field/aturan khusus create bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    // Validasi khusus penambahan create dapat disimpan di sini
  });
export type CreateBookingOrderanHeaderDto = z.infer<
  typeof CreateBookingOrderanHeaderSchema
>;

// ------------------------
// 3. KHUSUS UPDATE
// ------------------------
export const UpdateBookingOrderanHeaderSchema = z
  .object({
    ...baseFields,
    // id: z.number({ required_error: 'Id wajib diisi untuk update' }),
    // Field atau aturan khusus update bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {});
export type UpdateBookingOrderanHeaderDto = z.infer<
  typeof UpdateBookingOrderanHeaderSchema
>;
