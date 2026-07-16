import { isRecordExistCI } from 'src/utils/utils.service';
import { z } from 'zod';

export const UpdateCabangSchema = z
  .object({
    // id = varchar UUID, bukan angka. z.number() bikin self-exclude di
    // isRecordExist meleset (id UUID != angka) → edit tanpa ganti nama/kode
    // salah dianggap "sudah ada".
    id: z.string().optional(),
    kodecabang: z
      .string()
      .trim()
      .min(1, { message: 'Kode Cabang Wajib Diisi' })
      .max(255),
    nama: z.string().trim().min(1, { message: 'Nama Cabang Wajib Diisi' }).max(255),
    keterangan: z.string().trim().min(1, { message: 'Keterangan Wajib Diisi' }),

    statusaktif: z.string().min(1, { message: 'Status Aktif is required' }),
    statusaktif_text: z.string().nullable().optional(),

    modifiedby: z.string().nullable().optional(),
  })
  .superRefine(async (data, ctx) => {
    // Nama cabang TIDAK dicek unik — boleh sama. Hanya kodecabang yang unik,
    // case-insensitive + trim (isRecordExistCI), self-exclude via data.id.
    const kodeExists = await isRecordExistCI(
      'kodecabang',
      data.kodecabang,
      'cabang',
      data.id ?? undefined,
    );
    if (kodeExists) {
      ctx.addIssue({
        path: ['kodecabang'],
        code: 'custom',
        message: 'Kode Cabang dengan kode ini sudah ada',
      });
    }
  });

export type UpdateCabangDto = z.infer<typeof UpdateCabangSchema>;
