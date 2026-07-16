import { z } from 'zod';
import { isRecordExist } from 'src/utils/utils.service';

export const UpdateBiayaemklSchema = z.object({
  nama: z.string().trim().min(1, { message: 'NAMA is required' }),

  keterangan: z.string().trim().min(1, { message: 'KETERANGAN is required' }),

  // FK varchar(200) ke tabel biaya — id string (UUID), bukan angka.
  biaya_id: z.string().min(1, { message: 'BIAYA is required' }),
  biaya_text: z.string().nullable().optional(),

  coahut: z.string().trim().min(1, { message: 'Coa Hutang is required' }),
  keterangancoahut: z.string().nullable().optional(),

  // FK varchar(200) ke tabel jenisorder — id string, bukan angka.
  jenisorder_id: z.string().optional().nullable(),
  jenisorderan_text: z.string().nullable().optional(),

  statusaktif: z.string().min(1, { message: 'STATUSAKTIF is required' }),
  text: z.string().nullable().optional(),

  statusbiayabl: z.string().min(1, { message: 'Status Biaya BL is required' }),
  statusbiayabl_text: z.string().nullable().optional(),

  statusseal: z.string().min(1, { message: 'Status Seal is required' }),
  statusseal_text: z.string().nullable().optional(),

  statustagih: z.string().min(1, { message: 'Status Tagih is required' }),

  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type UpdateBiayaemklDto = z.infer<typeof UpdateBiayaemklSchema>;
