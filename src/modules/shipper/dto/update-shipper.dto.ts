import { isRecordExistCI } from 'src/utils/utils.service';
import { z } from 'zod';

export const UpdateShipperSchema = z
  .object({
    // id varchar(200) UUID — bukan number; dipakai juga sebagai excludeId di
    // isRecordExist (terima string) & where('id', id) saat update.
    id: z.string().optional(),
    nama: z.string().trim().min(1, { message: 'NAMA is required' }),

    keterangan: z.string().nullable().optional(),
    contactperson: z.string().nullable().optional(),
    alamat: z.string().nullable().optional(),

    coa: z.string().min(1, { message: 'COA is required' }),
    coa_text: z.string().nullable().optional(),

    coapiutang: z.string().min(1, { message: 'COAPIUTANG is required' }),
    coapiutang_text: z.string().nullable().optional(),

    coahutang: z.string().min(1, { message: 'COAHUTANG is required' }),
    coahutang_text: z.string().nullable().optional(),

    kota: z.string().nullable().optional(),
    kodepos: z.string().nullable().optional(),
    telp: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    fax: z.string().nullable().optional(),
    web: z.string().nullable().optional(),

    creditlimit: z.string().min(1, { message: 'CREDIT LIMIT is required' }),
    creditterm: z.number().min(1, { message: 'CREDIT TERM is required' }),
    credittermplus: z
      .number()
      .min(1, { message: 'CREDIT TERM PLUS is required' }),

    npwp: z.string().min(1, { message: 'NPWP Wajib Diisi' }),

    coagiro: z.string().min(1, { message: 'COA GIRO is required' }),
    coagiro_text: z.string().nullable().optional(),

    ppn: z.string().nullable().optional(),
    titipke: z.string().nullable().optional(),
    ppnbatalmuat: z.string().nullable().optional(),
    grup: z.string().nullable().optional(),
    formatdeliveryreport: z.number().nullable().optional(),
    comodity: z.string().nullable().optional(),
    namashippercetak: z.string().nullable().optional(),
    formatcetak: z.number().nullable().optional(),

    // marketing_id varchar(200) UUID (FK marketing) → string, bukan number.
    marketing_id: z.string().min(1, { message: 'MARKETING ID is required' }),
    marketing_text: z.string().nullable().optional(),

    blok: z.string().nullable().optional(),
    nomor: z.string().nullable().optional(),
    rt: z.string().nullable().optional(),
    rw: z.string().nullable().optional(),
    kelurahan: z.string().nullable().optional(),
    kabupaten: z.string().nullable().optional(),
    kecamatan: z.string().nullable().optional(),
    propinsi: z.string().nullable().optional(),
    isdpp10psn: z.string().nullable().optional(),
    usertracing: z.string().nullable().optional(),
    passwordtracing: z.string().nullable().optional(),

    kodeprospek: z.string().min(1, { message: 'KODEP ROSPEK Wajib Diisi' }),
    namashipperprospek: z
      .string()
      .min(1, { message: 'NAMA SHIPPER PROSPEK Wajib Diisi' }),

    emaildelay: z.string().nullable().optional(),
    keterangan1barisinvoice: z.string().nullable().optional(),
    nik: z.string().nullable().optional(),
    namaparaf: z.string().nullable().optional(),
    saldopiutang: z.string().nullable().optional(),
    keteranganshipperjobminus: z.string().nullable().optional(),
    tglemailshipperjobminus: z.string().nullable().optional(),
    tgllahir: z.string().min(1, { message: 'TGL LAHIR Wajib Diisi' }),
    idshipperasal: z.number().nullable().optional(),
    shipperasal_text: z.string().nullable().optional(),

    initial: z.string().nullable().optional(),
    tipe: z.string().nullable().optional(),
    idtipe: z.number().nullable().optional(),
    idinitial: z.number().nullable().optional(),
    nshipperprospek: z.string().nullable().optional(),
    // parentshipper_id varchar(200) UUID (self-FK shipper.id) → string.
    parentshipper_id: z.string().nullable().optional(),
    parentshipper_text: z.string().nullable().optional(),

    npwpnik: z.string().nullable().optional(),
    nitku: z.string().nullable().optional(),
    kodepajak: z.string().nullable().optional(),

    statusaktif: z.string().min(1, { message: 'STATUSAKTIF is required' }),
    text: z.string().nullable().optional(),

    modifiedby: z.string().nullable().optional(),
  })
  .superRefine(async (data, ctx) => {
    const coaValues = [
      { field: 'coa', value: data.coa, name: 'COA' },
      { field: 'coapiutang', value: data.coapiutang, name: 'COA Piutang' },
      { field: 'coahutang', value: data.coahutang, name: 'COA Hutang' },
      { field: 'coagiro', value: data.coagiro, name: 'COA Giro' },
    ];

    for (let i = 0; i < coaValues.length; i++) {
      for (let j = i + 1; j < coaValues.length; j++) {
        const first = coaValues[i];
        const second = coaValues[j];

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
  })
  .superRefine(async (data, ctx) => {
    const existsName = await isRecordExistCI(
      'nama',
      data.nama,
      'shipper',
      data.id ?? undefined,
    );
    if (existsName) {
      ctx.addIssue({
        path: ['nama'],
        code: 'custom',
        message: 'Shipper dengan nama ini sudah ada',
      });
    }
  });

export type UpdateShipperDto = z.infer<typeof UpdateShipperSchema>;
