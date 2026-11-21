import {
  CreateEstimasiBiayaHeaderSchema,
  UpdateEstimasiBiayaHeaderSchema,
} from './create-estimasi-biaya-header.dto';

/**
 * Semua id di modul ini BERTIPE TEKS sejak migrasi UUID — sama seperti
 * create-bl-header.dto.spec.ts:
 *  - baris BARU dari form dikirim '0' (STRING, bukan angka 0)
 *  - baris hasil EDIT dan seluruh lookup membawa UUID teks
 */
const detailBiayaBaru = {
  id: '0',
  nobukti: 'ESM 0001/XI/2026',
  biayaemkl_id: '02-019F4B00-539D-7BE4-9849-FF69D9DF2042',
  biayaemkl_nama: 'BIAYA BONGKAR',
  nominal: '150000',
  nilaiasuransi: '0',
  nominaldisc: '0',
  nominalsebelumdisc: '0',
  nominaltradoluar: '0',
};

const detailInvoiceBaru = {
  id: '0',
  nobukti: 'ESM 0001/XI/2026',
  biayaemkl_id: '02-019F4B00-539D-7BE4-9849-FF69D9DF2042',
  biayaemkl_nama: 'BIAYA BONGKAR',
  nominal: '150000',
};

const detailBiayaHasilEdit = {
  ...detailBiayaBaru,
  id: '02-019FFF2F-CA34-7B50-9516-13476006E83E',
  estimasibiaya_id: '02-019FFF2C-04FA-704E-92DE-FF88801CE8A0',
};

// Payload seperti yang dikirim form: seluruh *_id berasal dari LookUp, jadi teks.
const payloadCreate = {
  tglbukti: '19-11-2026',
  jenisorder_id: '02-019F5A2C-F2FC-72CF-9F18-C3737958D219',
  jenisorder_nama: 'EKSPOR',
  orderan_nobukti: 'ORD 0001/XI/2026',
  nominal: '1500000',
  shipper_id: '02-019FBB26-3876-7F43-A563-7AF0882225E0',
  shipper_nama: 'PT TAS',
  statusppn: '02-DBCF9E01-CCB1-8670-8D8F-A5FB074D928A',
  statusppn_nama: 'YA',
  asuransi_id: '02-01A04768-BF28-7ADF-B00F-F6D00EC48CAC',
  asuransi_nama: 'ASURANSI A',
  detailsbiaya: [detailBiayaBaru],
  detailsinvoice: [detailInvoiceBaru],
};

const pesan = (hasil: any): string[] =>
  hasil.success ? [] : hasil.error.errors.map((e: any) => e.message);

describe('CreateEstimasiBiayaHeaderSchema', () => {
  it("menerima detail baru dengan id '0' (STRING)", () => {
    expect(
      pesan(CreateEstimasiBiayaHeaderSchema.safeParse(payloadCreate)),
    ).toEqual([]);
  });

  it('menerima seluruh *_id lookup berupa UUID TEKS', () => {
    expect(
      pesan(
        CreateEstimasiBiayaHeaderSchema.safeParse({
          ...payloadCreate,
          detailsbiaya: [detailBiayaHasilEdit],
        }),
      ),
    ).toEqual([]);
  });

  it('tetap menolak JENIS ORDER kosong', () => {
    const hasil = CreateEstimasiBiayaHeaderSchema.safeParse({
      ...payloadCreate,
      jenisorder_id: '',
    });
    expect(pesan(hasil)).toContain('JENIS ORDER WAJIB DIISI');
  });

  it('tetap menolak estimasi tanpa detail biaya', () => {
    const hasil = CreateEstimasiBiayaHeaderSchema.safeParse({
      ...payloadCreate,
      detailsbiaya: [],
    });
    expect(hasil.success).toBe(false);
  });

  it('menolak id detail berupa ANGKA — sumbernya yang harus kirim string', () => {
    const hasil = CreateEstimasiBiayaHeaderSchema.safeParse({
      ...payloadCreate,
      detailsbiaya: [{ ...detailBiayaBaru, id: 0 as any }],
    });
    expect(hasil.success).toBe(false);
  });
});

describe('UpdateEstimasiBiayaHeaderSchema', () => {
  it('menerima id header UUID teks + detail id UUID teks', () => {
    expect(
      pesan(
        UpdateEstimasiBiayaHeaderSchema.safeParse({
          ...payloadCreate,
          id: '02-019FFF2C-04FA-704E-92DE-FF88801CE8A0',
          detailsbiaya: [detailBiayaHasilEdit],
        }),
      ),
    ).toEqual([]);
  });

  it('menolak id header berupa angka — harus teks', () => {
    const hasil = UpdateEstimasiBiayaHeaderSchema.safeParse({
      ...payloadCreate,
      id: 357 as any,
    });
    expect(hasil.success).toBe(false);
  });

  it('tetap menolak update tanpa id', () => {
    const hasil = UpdateEstimasiBiayaHeaderSchema.safeParse(payloadCreate);
    expect(pesan(hasil)).toContain('Id wajib diisi untuk update');
  });
});
