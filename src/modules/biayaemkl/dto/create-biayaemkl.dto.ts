import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';

export const CreateBiayaemklSchema = z.object({
  nama: z
    .string()
    .trim()
    .min(1, { message: 'Nama Wajib Diisi' })
    .max(100)
    .refine(
      async (value) => {
        const exists = await isRecordExistCI('nama', value, 'biayaemkl');
        return !exists; // Validasi jika nama sudah ada
      },
      {
        message: 'Biaya EMKL dengan dengan nama ini sudah ada',
      },
    ),

  keterangan: z.string().trim().min(1, { message: 'KETERANGAN is required' }),

  // FK varchar(200) ke tabel biaya — id string (UUID), bukan angka.
  biaya_id: z.string().min(1, { message: 'BIAYA is required' }),
  biaya_text: z.string().nullable().optional(),

  coahut: z.string().nullable().optional(),
  keterangancoahut: z.string().nullable().optional(),

  // FK varchar(200) ke tabel jenisorder — id string, bukan angka.
  jenisorder_id: z.string().min(1, { message: 'JENIS ORDERAN is required' }),
  jenisorderan_text: z.string().nullable().optional(),

  statusaktif: z.string().min(1, { message: 'Status Aktif is required' }),
  text: z.string().nullable().optional(),

  statusbiayabl: z.string().min(1, { message: 'Status Biaya BL is required' }),
  statusbiayabl_text: z.string().nullable().optional(),

  statusseal: z.string().min(1, { message: 'Status Seal is required' }),
  statusseal_text: z.string().nullable().optional(),

  statustagih: z.string().min(1, { message: 'Status Tagih is required' }),
  statustagih_text: z.string().nullable().optional(),

  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type CreateBiayaemklDto = z.infer<typeof CreateBiayaemklSchema>;
