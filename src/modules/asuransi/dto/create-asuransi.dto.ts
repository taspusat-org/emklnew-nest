import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';

export const CreateAsuransiSchema = z.object({
  nama: z
    .string()
    .trim()
    .min(1, { message: 'Nama Wajib Diisi' })
    .max(100)
    .refine(
      async (value) => {
        const exists = await isRecordExistCI('nama', value, 'asuransi');
        return !exists; // Validasi jika nama sudah ada
      },
      {
        message: 'Asuransi dengan nama ini sudah ada',
      },
    ),
  keterangan: z.string().trim().optional(),
  
  contactperson: z.string().trim().optional(),
  alamat: z.string().trim().optional(),
  kota: z.string().trim().optional(),
  kodepos: z.string().trim().optional(),
  notelp: z.string().trim().optional(),
  email: z.string().trim().optional(),
  npwp: z.string().trim().optional(),

  fax: z.string().nullable().optional(),
  web: z.string().nullable().optional(),

  ratemodal: z.string().nullable().optional(),
  ratejual: z.string().nullable().optional(),
  nominalasuransi: z.string().nullable().optional(),
  rateopendoor: z.string().nullable().optional(),
  adminbiaya: z.string().nullable().optional(),
  admintagih: z.string().nullable().optional(),
  batas1: z.string().nullable().optional(),
  batas2: z.string().nullable().optional(),
  batas3: z.string().nullable().optional(),
  materai1: z.string().nullable().optional(),
  materai2: z.string().nullable().optional(),
  materai3: z.string().nullable().optional(),

  statusaktif: z.string().optional(),
  text: z.string().nullable().optional(),

  info: z.string().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});

export type CreateAsuransiDto = z.infer<typeof CreateAsuransiSchema>;

// import { z } from 'zod';
// import { isRecordExistCI } from 'src/utils/utils.service';

// export const CreateAsuransiSchema = z.object({
//   nama: z
//     .string()
//     .trim()
//     .min(1, { message: 'Nama Wajib Diisi' })
//     .max(100)
//     .refine(
//       async (value) => {
//         const exists = await isRecordExistCI('nama', value, 'asuransi');
//         return !exists; // Validasi jika nama sudah ada
//       },
//       {
//         message: 'Asuransi dengan nama ini sudah ada',
//       },
//     ),
//   keterangan: z.string().trim().min(1, { message: 'KETERANGAN is required' }),
  
//   contactperson: z.string().trim().min(1, { message: 'CONTACT PERSON is required' }),
//   alamat: z.string().trim().min(1, { message: 'ALAMAT is required' }),
//   kota: z.string().trim().min(1, { message: 'KOTA is required' }),
//   kodepos: z.string().trim().min(1, { message: 'KODE POS is required' }),
//   notelp: z.string().trim().min(1, { message: 'NO TELP is required' }),
//   email: z.string().trim().min(1, { message: 'EMAIL is required' }),
//   npwp: z.string().trim().min(1, { message: 'NPWP is required' }),

//   fax: z.string().nullable().optional(),
//   web: z.string().nullable().optional(),

//   ratemodal: z.number({ required_error: 'RATE MODAL is required', invalid_type_error: 'RATE MODAL must be a number' }),
//   ratejual: z.number({ required_error: 'RATE JUAL is required', invalid_type_error: 'RATE JUAL must be a number' }),
//   nominalasuransi: z.number({ required_error: 'NOMINAL ASURANSI is required', invalid_type_error: 'NOMINAL ASURANSI must be a number' }),
//   rateopendoor: z.number({ required_error: 'RATE OPEN DOOR is required', invalid_type_error: 'RATE OPEN DOOR must be a number' }),
//   adminbiaya: z.number({ required_error: 'ADMIN BIAYA is required', invalid_type_error: 'ADMIN BIAYA must be a number' }),
//   admintagih: z.number({ required_error: 'ADMIN TAGIH is required', invalid_type_error: 'ADMIN TAGIH must be a number' }),
//   batas1: z.number({ required_error: 'BATAS 1 is required', invalid_type_error: 'BATAS 1 must be a number' }),
//   batas2: z.number({ required_error: 'BATAS 2 is required', invalid_type_error: 'BATAS 2 must be a number' }),
//   batas3: z.number({ required_error: 'BATAS 3 is required', invalid_type_error: 'BATAS 3 must be a number' }),
//   materai1: z.number({ required_error: 'MATERAI 1 is required', invalid_type_error: 'MATERAI 1 must be a number' }),
//   materai2: z.number({ required_error: 'MATERAI 2 is required', invalid_type_error: 'MATERAI 2 must be a number' }),
//   materai3: z.number({ required_error: 'MATERAI 3 is required', invalid_type_error: 'MATERAI 3 must be a number' }),

//   statusaktif: z.string().min(1, { message: 'Status Aktif is required' }),
//   text: z.string().nullable().optional(),

//   info: z.string().nullable().optional(),
//   modifiedby: z.string().nullable().optional(),
// });

// export type CreateAsuransiDto = z.infer<typeof CreateAsuransiSchema>;