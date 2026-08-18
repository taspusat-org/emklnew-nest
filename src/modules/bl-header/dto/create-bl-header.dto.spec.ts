import { CreateBlSchema, UpdateBlSchema } from './create-bl-header.dto';

/**
 * Semua id di modul ini BERTIPE TEKS sejak migrasi UUID:
 *  - baris BARU dari form dikirim '0' (STRING, bukan angka 0)
 *  - baris hasil EDIT membawa UUID teks
 *
 * Dulu DTO ini `z.number()` sehingga UUID ditolak saat edit; setelah dibalik ke
 * `z.string()`, giliran angka 0 dari form yang ditolak saat create. Yang
 * diluruskan sumbernya (form mengirim '0'), bukan schema-nya dilonggarkan.
 */
const detailBaru = {
  id: '0',
  bl_nobukti: 'tes',
  shippinginstructiondetail_nobukti: '0001/TAS/SI/ALKEN/MDN-TT/VIII/2026',
  asalpelabuhan: 'ASAL MUAT TEST1',
  keterangan: 'tes123',
  consignee: 'PT TAS',
  shipper: 'ST',
  comodity: 'GENERAL CARGO',
  notifyparty: 'TES',
  emkllain_nama: 'TEST',
  pelayaran_nama: 'ALKEN',
};

const detailHasilEdit = {
  ...detailBaru,
  id: '02-019FFF2F-CA34-7B50-9516-13476006E83E',
  bl_id: '02-019FFF2C-04FA-704E-92DE-FF88801CE8A0',
};

// Payload persis dari Network tab saat ADD.
const payloadCreate = {
  shippinginstruction_nobukti: 'SI 0003/VIII/2026',
  tglbukti: '14-08-2026',
  schedule_id: '02-019FFA84-A469-7D5B-A747-F0E675FC6C6A',
  voyberangkat: 'TES',
  kapal_id: '02-58D39E01-A8E6-3E75-ADCB-9CA66E4AA92E',
  kapal_nama: 'ABC',
  tglberangkat: '14-08-2026',
  tujuankapal_id: '02-BAD29E01-5EFC-2275-B049-FFDC224C9376',
  tujuankapal_nama: 'TUJUAN KAPAL 2',
  details: [detailBaru],
};

const pesan = (hasil: any): string[] =>
  hasil.success ? [] : hasil.error.errors.map((e: any) => e.message);

describe('CreateBlSchema', () => {
  it("menerima detail baru dengan id '0' (STRING)", () => {
    expect(pesan(CreateBlSchema.safeParse(payloadCreate))).toEqual([]);
  });

  it('menerima detail dengan id UUID TEKS', () => {
    expect(
      pesan(
        CreateBlSchema.safeParse({
          ...payloadCreate,
          details: [detailHasilEdit],
        }),
      ),
    ).toEqual([]);
  });

  it('tetap menolak SCHEDULE kosong', () => {
    const hasil = CreateBlSchema.safeParse({
      ...payloadCreate,
      schedule_id: '',
    });
    expect(pesan(hasil)).toContain('SCHEDULE WAJIB DIISI');
  });

  it('tetap menolak BL tanpa detail', () => {
    const hasil = CreateBlSchema.safeParse({ ...payloadCreate, details: [] });
    expect(hasil.success).toBe(false);
  });

  it('menolak id detail berupa ANGKA — sumbernya yang harus kirim string', () => {
    const hasil = CreateBlSchema.safeParse({
      ...payloadCreate,
      details: [{ ...detailBaru, id: 0 as any }],
    });
    expect(hasil.success).toBe(false);
  });
});

describe('UpdateBlSchema', () => {
  it('menerima id header UUID teks + detail id UUID teks', () => {
    expect(
      pesan(
        UpdateBlSchema.safeParse({
          ...payloadCreate,
          id: '02-019FFF2C-04FA-704E-92DE-FF88801CE8A0',
          details: [detailHasilEdit],
        }),
      ),
    ).toEqual([]);
  });

  it('menolak id header berupa angka — harus teks', () => {
    const hasil = UpdateBlSchema.safeParse({
      ...payloadCreate,
      id: 357 as any,
      details: [detailBaru],
    });
    expect(hasil.success).toBe(false);
  });

  it('tetap menolak update tanpa id', () => {
    const hasil = UpdateBlSchema.safeParse({
      ...payloadCreate,
      details: [detailHasilEdit],
    });
    expect(pesan(hasil)).toContain('Id wajib diisi untuk update');
  });
});
