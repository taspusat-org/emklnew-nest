import { isRecordExistCI } from 'src/utils/utils.service';
import { z } from 'zod';

export const UpdateTradoSchema = z
  .object({
    // id & status* = varchar UUID, bukan angka. z.number() bikin self-exclude
    // di isRecordExist meleset (id UUID != angka) sehingga edit tanpa ganti
    // nama salah dianggap "nama sudah ada".
    id: z.string().optional(),
    nama: z
      .string()
      .trim()
      .min(1, { message: 'Trado Wajib Diisi' })
      .max(255),
    keterangan: z.string().trim().min(1, { message: 'Keterangan Wajib Diisi' }),
    // statusaktif menyimpan id parameter (varchar UUID), bukan angka. Jangan
    // z.number() — frontend mengirim id string sehingga z.number() menolaknya.
    statusaktif: z.string().min(1, { message: 'Status Aktif Wajib Diisi' }),
    statusaktif_text: z.string().nullable().optional(),
    modifiedby: z.string().nullable().optional(),
  })
  .superRefine(async (data, ctx) => {
    // Cek case-insensitive + trim (kecuali baris ini sendiri via data.id),
    // seragam dengan form add. "TEST", "test", " test " dianggap sama.
    const existsName = await isRecordExistCI(
      'nama',
      data.nama,
      'trado',
      data.id ?? undefined,
    );
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Trado dengan nama ini sudah ada',
      });
    }
  });
export type UpdateTradoDto = z.infer<typeof UpdateTradoSchema>;
