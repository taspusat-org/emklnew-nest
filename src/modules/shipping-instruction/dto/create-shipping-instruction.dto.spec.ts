import {
  CreateShippingInstructionSchema,
  UpdateShippingInstructionSchema,
} from './create-shipping-instruction.dto';

const rincian = {
  orderanmuatan_nobukti: '1/VIII/MKT/TT/26',
  comodity: 'GENERAL CARGO',
  keterangan: null,
};

const detail = {
  daftarbl_id: '02-BAD29E01-845D-FB7A-95CD-5CCFD2459583',
  containerpelayaran_id: '02-BBD29E01-188D-CE72-8DAB-F7C2224CBD2C',
  emkl_id: 8, // sengaja angka: id di DB masih campur teks & angka
  tujuankapal_id: '02-BAD29E01-5EFC-0075-AF47-A33B1D45A5FE',
  asalpelabuhan: 'ASAL MUAT TEST1',
  consignee: 'PT TAS',
  shipper: 'ST',
  comodity: 'GENERAL CARGO',
  notifyparty: 'TES',
  totalgw: '1000',
  detailsrincian: [rincian],
};

const payload = {
  schedule_id: '02-019FFA84-A469-7D5B-A747-F0E675FC6C6A',
  voyberangkat: 'TES',
  kapal_id: '02-58D39E01-A8E6-0572-B49A-4A286C4A90BC',
  tglberangkat: '14-08-2026',
  tujuankapal_id: '02-BAD29E01-5EFC-0075-AF47-A33B1D45A5FE',
  details: [detail],
};

const pesanError = (result: any): string[] =>
  result.success ? [] : result.error.errors.map((e: any) => e.message);

describe.each([
  ['CreateShippingInstructionSchema', CreateShippingInstructionSchema],
  ['UpdateShippingInstructionSchema', UpdateShippingInstructionSchema],
])('%s', (_nama, schema: any) => {
  it('menerima payload lengkap (detail + job)', () => {
    expect(schema.safeParse(payload).success).toBe(true);
  });

  it('menolak SI tanpa detail sama sekali', () => {
    const result = schema.safeParse({ ...payload, details: [] });

    expect(result.success).toBe(false);
    expect(pesanError(result)).toContain(
      'DETAIL SHIPPING INSTRUCTION WAJIB DIISI',
    );
  });

  it('menolak SI yang detailnya belum punya job', () => {
    const result = schema.safeParse({
      ...payload,
      details: [{ ...detail, detailsrincian: [] }],
    });

    expect(result.success).toBe(false);
    expect(pesanError(result)).toContain('JOB WAJIB DIISI');
  });

  it('menolak kalau key detailsrincian tidak dikirim', () => {
    const { detailsrincian, ...tanpaRincian } = detail;
    const result = schema.safeParse({ ...payload, details: [tanpaRincian] });

    expect(result.success).toBe(false);
    expect(pesanError(result)).toContain('JOB WAJIB DIISI');
  });

  it('menolak baris job dengan nobukti orderan muatan kosong', () => {
    const result = schema.safeParse({
      ...payload,
      details: [
        { ...detail, detailsrincian: [{ ...rincian, orderanmuatan_nobukti: '' }] },
      ],
    });

    expect(result.success).toBe(false);
    expect(pesanError(result)).toContain('JOB WAJIB DIISI');
  });
});
