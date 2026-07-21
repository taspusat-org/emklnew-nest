import { z } from 'zod';
import { isRecordExistCI } from 'src/utils/utils.service';
import { ApiProperty } from '@nestjs/swagger';
// ------------------------
// 1. BASE FIELDS
// ------------------------
const baseFields = {
  nama: z.string().trim().min(1, { message: 'Nama Wajib Diisi' }).max(100),
  order: z.number().int({ message: 'Order harus bilangan bulat' }),
  keterangan: z.string().min(1, { message: 'Keterangan Wajib Diisi' }).max(100),
  akuntansi_id: z
    .string()
    .min(1, { message: 'Akuntansi Id Wajib Diisi' }),
  statusaktif: z.string()
    .min(1, { message: 'Status Aktif Wajib Diisi' }),
  // modifiedby diisi di backend, optional di request body
  modifiedby: z.string().max(200).optional(),
};
// ------------------------
// 2. KHUSUS CREATE
// ------------------------
export const CreateTypeAkuntansiSchema = z
  .object({
    ...baseFields,
    // Field/aturan khusus create bisa ditambah di sini
  })
  .superRefine(async (data, ctx) => {
    // Cek unik hanya untuk create (excludeId tidak ada)
    const existsName = await isRecordExistCI('nama', data.nama, 'typeakuntansi');
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Type Akuntansi dengan nama ini sudah ada',
      });
    }
    // Validasi khusus penambahan create dapat disimpan di sini
  });
export type CreateTypeAkuntansiDto = z.infer<typeof CreateTypeAkuntansiSchema>;
// ------------------------
// 3. KHUSUS UPDATE
// ------------------------
export const UpdateTypeAkuntansiSchema = z
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
      'typeakuntansi',
      data.id,
    );
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Type Akuntansi dengan nama ini sudah ada',
      });
    }
    // Validasi khusus update bisa diletakkan di sini
  });
export type UpdateTypeAkuntansiDto = z.infer<typeof UpdateTypeAkuntansiSchema>;

export class CreateTypeAkuntansiSwaggerDto {
  @ApiProperty({
    example: 'TEST',
    description: 'Nama Harus Diisi Dan tidak boleh sama',
  })
  nama: string;

  @ApiProperty()
  order: number;

  @ApiProperty()
  keterangan: string;

  @ApiProperty()
  akuntansi_id: string;

  @ApiProperty()
  statusaktif: number;

  @ApiProperty({ required: false })
  modifiedby?: string;
}
