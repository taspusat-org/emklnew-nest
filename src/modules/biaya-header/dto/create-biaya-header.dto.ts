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

  keterangan: z.string().nullable().optional(),
  noinvoice: z.string().nullable().optional(),

  relasi_id: z
    .number({
      required_error: 'RELASI WAJIB DIISI',
    })
    .min(1, { message: 'RELASI WAJIB DIISI' }),
  relasi_nama: z.string().nullable().optional(),

  dibayarke: z.string().nullable().optional(),

  biayaextra_id: z.number().nullable().optional(),
  // biayaextra_nobukti: z
  //   .string({ message: 'NO BUKTI BIAYA EXTRA WAJIB DIISI' })
  //   .nonempty({ message: 'NO BUKTI BIAYA EXTRA WAJIB DIISI' }),
  biayaextra_nobukti: z.string().nullable().optional(),

  modifiedby: z.string().max(200).optional(),
};

const baseBiayaMuatanDetailFields = z.object({
  id: z.number().optional(),
  nobukti: z.string().nullable().optional(),

  orderanmuatan_id: z.number().nullable().optional(),
  orderanmuatan_nobukti: z.string().nullable().optional(),

  tgljob: z.string().nullable(),
  nocontainer: z.string().nullable(),
  noseal: z.string().nullable(),
  lokasistuffing_nama: z.string().nullable(),
  shipper_nama: z.string().nullable(),
  container_nama: z.string().nullable(),

  estimasi: z.string().nullable().optional(),
  nominal: z.string().nullable().optional(),
  keterangan: z.string().nullable().optional(),

  biayaextra_id: z.number().nullable().optional(),
  biayaextra_nobukti: z.string().nullable().optional(),
  biayaextra_nobukti_json: z.string().nullable().optional(),
});

export const CreateBiayaHeaderSchema = z.object({
  ...baseFields,
  details: z.array(baseBiayaMuatanDetailFields).min(1),
  // Field/aturan khusus create bisa ditambah di sini
});
export type CreateBiayaHeaderDto = z.infer<typeof CreateBiayaHeaderSchema>;

export const UpdateBiayaHeaderSchema = z.object({
  ...baseFields,
  id: z.number({ required_error: 'Id wajib diisi untuk update' }),
  details: z.array(baseBiayaMuatanDetailFields).min(1),
  // Field atau aturan khusus update bisa ditambah di sini
});
export type UpdateBiayaHeaderDto = z.infer<typeof UpdateBiayaHeaderSchema>;
