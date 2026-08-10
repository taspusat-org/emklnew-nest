import {
  GENERIC_ERROR_MESSAGE,
  isTechnicalErrorMessage,
  toSafeErrorMessage,
} from './error-message';

const FK_JURNALUMUM =
  'insert into "jurnalumumdetail" ("coa", "created_at", "id") values ($1, $2, $3) returning * - insert or update on table "jurnalumumdetail" violates foreign key constraint "FK_jurnalumumdetail_coa_akunpusat"';

describe('toSafeErrorMessage', () => {
  it('menyamarkan pelanggaran foreign key sambil menyebut kolomnya', () => {
    expect(toSafeErrorMessage(FK_JURNALUMUM)).toBe(
      'ISIAN COA BELUM DIPILIH ATAU TIDAK TERDAFTAR. SILAKAN PILIH DARI DAFTAR YANG TERSEDIA.',
    );
  });

  it('menjelaskan data yang masih dipakai saat dihapus', () => {
    expect(
      toSafeErrorMessage(
        'update or delete on table "akunpusat" violates foreign key constraint "FK_jurnalumumdetail_coa_akunpusat" on table "jurnalumumdetail"',
      ),
    ).toBe(
      'DATA TIDAK DAPAT DIHAPUS ATAU DIUBAH KARENA MASIH DIGUNAKAN PADA DATA LAIN.',
    );
  });

  it('menerjemahkan error transaksi knex jadi pesan sistem sibuk', () => {
    expect(
      toSafeErrorMessage(
        'Transaction query already complete, run with DEBUG=knex:tx for more info',
      ),
    ).toBe(
      'SISTEM SEDANG SIBUK MEMPROSES DATA LAIN. SILAKAN COBA BEBERAPA SAAT LAGI.',
    );
  });

  it('menutup pesan developer berbahasa inggris dan stack trace', () => {
    expect(toSafeErrorMessage('Failed to fetch alatbayar data')).toBe(
      GENERIC_ERROR_MESSAGE,
    );
    expect(toSafeErrorMessage('Internal server error')).toBe(
      GENERIC_ERROR_MESSAGE,
    );
    expect(toSafeErrorMessage(undefined)).toBe(GENERIC_ERROR_MESSAGE);
  });

  it('membiarkan pesan aturan bisnis apa adanya', () => {
    const pesan = [
      'KAS/BANK WAJIB DIPILIH.',
      'Detail kas gantung tidak boleh kosong',
      'Line 1: Nominal harus diisi',
      'DATA TIDAK DITEMUKAN',
    ];

    pesan.forEach((p) => {
      expect(isTechnicalErrorMessage(p)).toBe(false);
      expect(toSafeErrorMessage(p)).toBe(p);
    });
  });
});
