import { z } from 'zod';

/**
 * Semua id (PK & FK) di database sudah bertipe TEXT (uuid v7), bukan integer
 * lagi. Yang perlu diwaspadai: grid mengirim `id: 0` untuk baris detail BARU —
 * angka, bukan string — sehingga `z.string()` polos menolaknya dengan 400
 * "Expected string, received number" dan simpan gagal tanpa penjelasan di UI.
 * Karena itu id detail diterima sebagai string ATAU number.
 */
const idBaris = z.union([z.string(), z.number()]).nullable().optional();

/**
 * estimasi & nominal dikirim InputCurrency sebagai string ter-format
 * ("100,000.00"), tapi bisa juga sudah berupa number saat payload dirakit
 * ulang. Keduanya diterima; yang ditolak hanya nilai kosong.
 */
const nominalWajib = (label: string) =>
  z
    .union([z.string(), z.number()])
    .refine((val) => String(val ?? '').trim() !== '', {
      message: `${label} WAJIB DIISI`,
    });

const baseFields = {
  tglbukti: z
    .string({ message: 'TGL BUKTI WAJIB DIISI' })
    .nonempty({ message: 'TGL BUKTI WAJIB DIISI' }),

  jenisorder_id: z
    .string({
      required_error: 'JENIS ORDER WAJIB DIISI',
    })
    .min(1, { message: 'JENIS ORDER WAJIB DIISI' }),
  jenisorder_nama: z.string().nullable().optional(),

  biayaemkl_id: z
    .string({
      required_error: 'BIAYA EMKL WAJIB DIISI',
    })
    .min(1, { message: 'BIAYA EMKL WAJIB DIISI' }),
  biayaemkl_nama: z.string().nullable().optional(),

  keterangan: z
    .string({ message: 'KETERANGAN WAJIB DIISI' })
    .nonempty({ message: 'KETERANGAN WAJIB DIISI' }),

  info: z.string().nullable().optional(),
  modifiedby: z.string().max(200).optional(),
};

const baseDetailsFields = z.object({
  id: idBaris,
  nobukti: z.string().nullable().optional(),
  panjar_id: idBaris,

  // Kolom bantu form (tidak disimpan) — hanya boleh tidak menggagalkan payload.
  orderanmuatan_id: idBaris,
  orderanmuatan_nobukti: z
    .string({ message: 'ORDERAN MUATAN WAJIB DIISI' })
    .nonempty({ message: 'ORDERAN MUATAN WAJIB DIISI' }),

  estimasi: nominalWajib('ESTIMASI'),
  nominal: nominalWajib('NOMINAL'),

  keterangan: z.string().nullable().optional(),
  info: z.string().nullable().optional(),
});

export const CreatePanjarHeaderSchema = z.object({
  ...baseFields,
  details: z.array(baseDetailsFields).min(1),
});
export type CreatePanjarheaderDto = z.infer<typeof CreatePanjarHeaderSchema>;

export const UpdatePanjarHeaderSchema = z.object({
  ...baseFields,
  details: z.array(baseDetailsFields).min(1),
  // id header selalu string: baris lama hasil migrasi ('7', '8', ...) maupun
  // baris baru (uuid v7) sama-sama tersimpan sebagai text.
  id: z.string({ required_error: 'Id wajib diisi untuk update' }),
});
export type UpdatePanjarheaderDto = z.infer<typeof UpdatePanjarHeaderSchema>;
