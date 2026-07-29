import { isRecordExistCI } from 'src/utils/utils.service';
import { z } from 'zod';

const baseFields = {
  nama: z
    .string()
    .trim()
    .min(1, { message: 'Nama Karyawan Wajib Diisi' })
    .max(255),
  kodeabsen: z.string().trim().nullable().optional(),
  absen_id: z.string().min(1, { message: 'ID Absen Wajib Diisi' }),
  // Tautan ke sistem HR eksternal yang tak tersedia di deployment ini.
  // TIDAK wajib: kolomnya punya FK self-reference ke karyawan(id), jadi nilai
  // sentinel lama ('0') selalu melanggar FK. Service menormalkannya jadi NULL.
  karyawan_id: z.string().trim().nullable().optional(),
  jabatan_id: z.string().min(1, { message: 'Jabatan Wajib Diisi' }),
  keterangan: z.string().trim().nullable().optional(),
  statusaktif: z.string(), // Ensure non-negative
  modifiedby: z.string().nullable().optional(),
};

export const createKaryawanSchema = z
  .object({
    ...baseFields,
  })
  .superRefine(async (data, ctx) => {
    // Unik berdasarkan NAMA (case-insensitive), bukan karyawan_id: kolom
    // karyawan_id mengacu ke sistem HR eksternal yang tak tersedia di
    // deployment ini sehingga seluruh baris bernilai '0' — cek unik di kolom
    // itu memblokir semua penambahan data.
    const existsName = await isRecordExistCI('nama', data.nama, 'karyawan');
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Nama karyawan ini sudah ada',
      });
    }
    // Validasi khusus penambahan create dapat disimpan di sini
  });
export type CreateKaryawanDto = z.infer<typeof createKaryawanSchema>;

export const updateKaryawanSchema = z
  .object({
    ...baseFields,
    id: z.string({ required_error: 'Id wajib diisi untuk update' }),
  })
  .superRefine(async (data, ctx) => {
    // Sama seperti create, tapi baris yang sedang diedit dikecualikan
    const existsName = await isRecordExistCI(
      'nama',
      data.nama,
      'karyawan',
      data.id,
    );
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Nama karyawan ini sudah ada',
      });
    }
    // Validasi khusus penambahan create dapat disimpan di sini
  });
export type UpdateKaryawanDto = z.infer<typeof updateKaryawanSchema>;
