import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';

export const CreateCabangSchema = z.object({
  // Keunikan kodecabang DI-cek case-insensitive + trim (isRecordExistCI):
  // 'test', 'TEST', dan ' test ' dianggap duplikat. (Permintaan user 2026-07-14;
  // menyimpang dari konvensi umum "kode = case-sensitive".)
  kodecabang: z
    .string()
    .min(1, { message: 'Kode Cabang Wajib Diisi' })
    .max(100)
    .refine(
      async (value) => {
        const exists = await isRecordExistCI('kodecabang', value, 'cabang');
        return !exists;
      },
      {
        message: 'Kode Cabang dengan kode ini sudah ada',
      },
    ),
  // Nama cabang TIDAK dicek unik — boleh sama. Hanya kodecabang yang wajib unik.
  nama: z.string().trim().min(1, { message: 'Nama Wajib Diisi' }).max(100),
  keterangan: z.string().trim().min(1, { message: 'KETERANGAN is required' }),

  // statusaktif menyimpan id parameter (varchar UUID), bukan angka. Jangan
  // z.number() — frontend mengirim id string sehingga z.number() menolaknya.
  statusaktif: z.string().min(1, { message: 'Status Aktif is required' }),
  statusaktif_text: z.string().nullable().optional(),

  modifiedby: z.string().nullable().optional(),
});

export type CreateCabangDto = z.infer<typeof CreateCabangSchema>;
