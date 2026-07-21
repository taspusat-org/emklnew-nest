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

  bankdari_id: z
    .string()
    .min(1, { message: 'BANK DARI' }),
  bankdari_nama: z.string().nullable().optional(),

  bankke_id: z
    .string()
    .min(1, { message: 'BANK KE WAJIB DISI' }),
  bankke_nama: z.string().nullable().optional(),

  alatbayar_id: z
    .string({ message: 'ALAT BAYAR WAJIB DISI' })
    .min(1, { message: 'ALAT BAYAR WAJIB DISI' }),
  alatbayar_nama: z.string().nullable().optional(),

  nowarkat: z.string().nullable().optional(),

  tgljatuhtempo: z
    .string({ message: 'TGL JATUH TEMPO WAJIB DIISI' })
    .nonempty({ message: 'TGL JATUH TEMPO WAJIB DIISI' }),

  nominal: z
    .string({ message: 'NOMINAL WAJIB DIISI' })
    .nonempty({ message: 'NOMINAL WAJIB DIISI' }),

  keterangan: z
    .string({ message: 'KETERANGAN WAJIB DIISI' })
    .nonempty({ message: 'KETERANGAN WAJIB DIISI' }),

  // modifiedby diisi di backend, optional di request body
  modifiedby: z.string().max(200).optional(),

  // nowarkat: z
  //   .string({ message: dynamicRequiredMessage('nowarkat') })
  //   .nonempty({ message: dynamicRequiredMessage('nowarkat') }),
};

// ------------------------
// 2. KHUSUS CREATE
// ------------------------
export const CreatePindahBukuSchema = z
  .object({
    ...baseFields,
    // Field/aturan khusus create bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    if (data.alatbayar_nama === 'Giro' && !data.nowarkat) {
      ctx.addIssue({
        path: ['nowarkat'],
        code: 'custom',
        message: 'No Warkat Wajib Diisi',
      });
    }
    const bankValues = [
      { field: 'bankdari_id', value: data.bankdari_id, name: 'BANK DARI' },
      { field: 'bankke_id', value: data.bankke_id, name: 'BANK KE' },
    ];

    for (let i = 0; i < bankValues.length; i++) {
      for (let j = i + 1; j < bankValues.length; j++) {
        const first = bankValues[i];
        const second = bankValues[j];

        if (
          first.value != null &&
          second.value != null &&
          first.value === second.value
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
export type CreatePindahBukuDto = z.infer<typeof CreatePindahBukuSchema>;

// ------------------------
// 3. KHUSUS UPDATE
// ------------------------
export const UpdatePindahBukuSchema = z
  .object({
    ...baseFields,
    // id: z.number({ required_error: 'Id wajib diisi untuk update' }),
    // Field atau aturan khusus update bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    if (data.alatbayar_nama === 'Giro' && !data.nowarkat) {
      ctx.addIssue({
        path: ['nowarkat'],
        code: 'custom',
        message: 'No Warkat Wajib Diisi',
      });
    }

    const bankValues = [
      { field: 'bankdari_id', value: data.bankdari_id, name: 'BANK DARI' },
      { field: 'bankke_id', value: data.bankke_id, name: 'BANK KE' },
    ];

    for (let i = 0; i < bankValues.length; i++) {
      for (let j = i + 1; j < bankValues.length; j++) {
        const first = bankValues[i];
        const second = bankValues[j];

        if (
          first.value != null &&
          second.value != null &&
          first.value === second.value
        ) {
          ctx.addIssue({
            path: [second.field as keyof typeof data],
            code: z.ZodIssueCode.custom,
            message: `${first.name} dan ${second.name} tidak boleh sama`,
          });
        }
      }
    }
  });
export type UpdatePindahBukuDto = z.infer<typeof UpdatePindahBukuSchema>;
