import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';

// ------------------------
// 1. BASE FIELDS
// ------------------------
const baseFields = {
  nama: z.string().trim().min(1, { message: 'Nama Wajib Diisi' }),
  keterangan: z
    .string({ message: 'Keterangan Wajib Diisi' })
    .nonempty({ message: 'Keterangan Wajib Diisi' }),

  coadebet: z.string().nullable().optional(),
  coadebet_nama: z.string().nullable().optional(),

  coakredit: z.string().nullable().optional(),
  coakredit_nama: z.string().nullable().optional(),

  coapostingkasbankdebet: z.string().nullable().optional(),
  coabankdebet_nama: z.string().nullable().optional(),

  coapostingkasbankkredit: z.string().nullable().optional(),
  coabankkredit_nama: z.string().nullable().optional(),

  coapostinghutangdebet: z.string().nullable().optional(),
  coahutangdebet_nama: z.string().nullable().optional(),

  coapostinghutangkredit: z.string().nullable().optional(),
  coahutangkredit_nama: z.string().nullable().optional(),

  coaproses: z.string().nullable().optional(),
  coaproses_nama: z.string().nullable().optional(),

  nilaiprosespenerimaan: z.string().nullable().optional(),
  nilaiprosespenerimaan_nama: z.string().nullable().optional(),

  nilaiprosespengeluaran: z.string().nullable().optional(),
  nilaiprosespengeluaran_nama: z.string().nullable().optional(),

  nilaiproseshutang: z.string().nullable().optional(),
  nilaiproseshutang_nama: z.string().nullable().optional(),

  statuspenarikan: z.string().nullable().optional(),
  statuspenarikan_nama: z.string().nullable().optional(),

  format: z
    .string()
    .min(1, { message: 'format Wajib Diisi' }),
  format_nama: z.string().nullable().optional(),

  statusaktif: z.string()
    .min(1, { message: 'Status Aktif Wajib Diisi' }),
  statusaktif_nama: z.string().nullable().optional(),

  // modifiedby diisi di backend, optional di request body
  modifiedby: z.string().max(200).optional(),
};

// ------------------------
// 2. KHUSUS CREATE
// ------------------------
export const CreatePengeluaranEmklSchema = z
  .object({
    ...baseFields,
    // Field/aturan khusus create bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    // Cek unik hanya untuk create (excludeId tidak ada)
    const existsName = await isRecordExistCI(
      'nama',
      data.nama,
      'pengeluaranemkl',
    );
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Pengeluaran EMKL dengan nama ini sudah ada',
      });
    }

    const coaValues = [
      { field: 'coadebet', value: data.coadebet, name: 'COA DEBET' },
      { field: 'coakredit', value: data.coakredit, name: 'COA KREDIT' },
      {
        field: 'coapostingkasbankdebet',
        value: data.coapostingkasbankdebet,
        name: 'COA POSTING KASBANK DEBET',
      },
      {
        field: 'coapostingkasbankkredit',
        value: data.coapostingkasbankkredit,
        name: 'COA POSTING KASBANK KREDIT',
      },
      {
        field: 'coapostinghutangdebet',
        value: data.coapostinghutangdebet,
        name: 'COA POSTING HUTANG DEBET',
      },
      {
        field: 'coapostinghutangkredit',
        value: data.coapostinghutangkredit,
        name: 'COA POSTING HUTANG KREDIT',
      },
      { field: 'coaproses', value: data.coaproses, name: 'COA PROSES' },
    ];

    for (let i = 0; i < coaValues.length; i++) {
      for (let j = i + 1; j < coaValues.length; j++) {
        const first = coaValues[i];
        const second = coaValues[j];

        const firstValue = first.value?.trim() ?? '';
        const secondValue = second.value?.trim() ?? '';

        // Hanya cek "tidak boleh sama" bila KEDUA field terisi.
        // Bila salah satu (atau keduanya) kosong, lewati agar tetap bisa disimpan.
        if (
          firstValue !== '' &&
          secondValue !== '' &&
          firstValue === secondValue
        ) {
          ctx.addIssue({
            path: [second.field as keyof typeof data],
            code: z.ZodIssueCode.custom,
            message: `${first.name} dan ${second.name} tidak boleh sama`,
          });
        }
      }
    }
    // Validasi khusus penambahan create dapat disimpan di sini
  });
export type CreatePengeluaranEmklDto = z.infer<
  typeof CreatePengeluaranEmklSchema
>;

// ------------------------
// 3. KHUSUS UPDATE
// ------------------------
export const UpdatePengeluaranEmklSchema = z
  .object({
    ...baseFields,
    id: z.string({ required_error: 'Id wajib diisi untuk update' }),
    // Field atau aturan khusus update bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    // Exclude diri sendiri dari pengecekan unik
    const existsName = await isRecordExistCI(
      'nama',
      data.nama,
      'pengeluaranemkl',
      data.id,
    );
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Pengeluaran EMKL dengan nama ini sudah ada',
      });
    }

    const coaValues = [
      { field: 'coadebet', value: data.coadebet, name: 'COA DEBET' },
      { field: 'coakredit', value: data.coakredit, name: 'COA KREDIT' },
      {
        field: 'coapostingkasbankdebet',
        value: data.coapostingkasbankdebet,
        name: 'COA POSTING KASBANK DEBET',
      },
      {
        field: 'coapostingkasbankkredit',
        value: data.coapostingkasbankkredit,
        name: 'COA POSTING KASBANK KREDIT',
      },
      {
        field: 'coapostinghutangdebet',
        value: data.coapostinghutangdebet,
        name: 'COA POSTING HUTANG DEBET',
      },
      {
        field: 'coapostinghutangkredit',
        value: data.coapostinghutangkredit,
        name: 'COA POSTING HUTANG KREDIT',
      },
      { field: 'coaproses', value: data.coaproses, name: 'COA PROSES' },
    ];

    for (let i = 0; i < coaValues.length; i++) {
      for (let j = i + 1; j < coaValues.length; j++) {
        const first = coaValues[i];
        const second = coaValues[j];

        const firstValue = first.value?.trim() ?? '';
        const secondValue = second.value?.trim() ?? '';

        // Hanya cek "tidak boleh sama" bila KEDUA field terisi.
        // Bila salah satu (atau keduanya) kosong, lewati agar tetap bisa disimpan.
        if (
          firstValue !== '' &&
          secondValue !== '' &&
          firstValue === secondValue
        ) {
          ctx.addIssue({
            path: [second.field as keyof typeof data],
            code: z.ZodIssueCode.custom,
            message: `${first.name} dan ${second.name} tidak boleh sama`,
          });
        }
      }
    }
    // Validasi khusus update bisa diletakkan di sini
  });
export type UpdatePengeluaranEmklDto = z.infer<
  typeof UpdatePengeluaranEmklSchema
>;
