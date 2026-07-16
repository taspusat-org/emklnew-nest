// type-akuntansi.schema.ts
import { z } from 'zod';
import { isRecordExist, isRecordExistCI } from 'src/utils/utils.service';

export const typeakuntansiSchema = (method: 'create' | 'update') => {
  if (method === 'create') {
    return z.object({
      nama: z
        .string()
        .min(1, { message: 'Nama Wajib Diisi' })
        .max(100)
        .refine(
          async (value) => {
            const exists = await isRecordExistCI('nama', value, 'typeakuntansi');
            return !exists; // Validasi jika nama sudah ada
          },
          {
            message: 'Type Akuntansi dengan nama ini sudah ada',
          },
        ),
      order: z.number().int({ message: 'Order must be an integer' }),
      keterangan: z
        .string()
        .min(1, { message: 'Keterangan Wajib Diisi' })
        .max(100),
      akuntansi_id: z
        .number()
        .int({ message: 'akuntansi_id must be an integer' })
        .min(1, { message: 'Akuntansi Id Wajib Diisi ' }),
      statusaktif: z.string()
        .min(1, { message: 'Status Aktif Wajib Diisi' }),
      modifiedby: z.string().max(200).optional(),
    });
  }
  if (method === 'update') {
    return z
      .object({
        id: z.number().optional(),
        nama: z
          .string()
          .trim()
          .min(1, { message: 'Nama Wajib Diisi' })
          .max(100)
          .refine(
            async (value) => {
              const exists = await isRecordExistCI(
                'nama',
                value,
                'typeakuntansi',
              );
              return !exists; // Validasi jika nama sudah ada
            },
            {
              message: 'Type Akuntansi dengan nama ini sudah ada',
            },
          ),
        order: z.number().int({ message: 'Order must be an integer' }),
        keterangan: z
          .string()
          .min(1, { message: 'Keterangan Wajib Diisi' })
          .max(100),
        akuntansi_id: z
          .number()
          .int({ message: 'akuntansi_id must be an integer' })
          .min(1, { message: 'Akuntansi Id Wajib Diisi ' }),
        statusaktif: z.string()
          .min(1, { message: 'Status Aktif Wajib Diisi' }),
        modifiedby: z.string().max(200).optional(),
      })
      .superRefine(async (data, ctx) => {
        const existsName = await isRecordExistCI(
          'nama',
          data.nama,
          'typeakuntansi',
        );
        if (existsName) {
          ctx.addIssue({
            path: ['nama'],
            code: 'custom',
            message: 'Type Akuntansi dengan nama ini sudah ada',
          });
        }

        const existsOrder = await isRecordExist(
          'order',
          data.order,
          'typeakuntansi',
        );
        if (existsOrder) {
          ctx.addIssue({
            path: ['order'],
            code: 'custom',
            message: 'Type Akuntansi dengan order ini sudah ada',
          });
        }
      });
  }
};

export type KaryawanInput = z.infer<
  ReturnType<typeof typeakuntansiSchema> & z.ZodType<any>
>;
