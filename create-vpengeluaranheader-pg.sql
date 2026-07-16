/*
  Postgres port of vpengeluaranheader.

  Konteks: DB tasemkl adalah PostgreSQL, tetapi view ini semula ditulis untuk SQL
  Server (lihat fix-vpengeluaranheader-bankid-cast.sql) dan TIDAK PERNAH dibuat di
  Postgres. Akibatnya PengeluaranheaderService.findAll() 500:
    1) service memanggil `exec sp_set_session_context ...` (sintaks MSSQL) — error di PG.
    2) query `vpengeluaranheader` gagal: relation does not exist.

  Port ini:
    - Membuat view di Postgres dengan kolom yang sama persis dgn SELECT findAll.
    - Filter tgl/bank dibaca dari GUC per-transaksi:
        current_setting('tas.tgldari'|'tas.tglsampai'|'tas.bank_id', true)
      yang di-set service via set_config(..., true). NULLIF(...,'') → treat
      kosong/NULL sebagai "tanpa filter".
    - Kolom `link` di-inline (nobukti unik → CTE STRING_AGG asli setara).
*/
CREATE OR REPLACE VIEW public.vpengeluaranheader AS
SELECT
  u.id,
  u.nobukti,
  u.tglbukti,
  u.relasi_id,
  u.keterangan,
  u.bank_id,
  u.postingdari,
  u.coakredit,
  u.dibayarke,
  u.alatbayar_id,
  u.nowarkat,
  u.tgljatuhtempo,
  u.pengeluaranemklgantung_nobukti,
  u.penerimaanemklgantung_nobukti,
  u.daftarbank_id,
  u.statusformat,
  u.modifiedby,
  u.created_at,
  u.updated_at,
  r.nama          AS relasi_text,
  b.nama          AS bank_text,
  a.keterangancoa AS coakredit_text,
  c.nama          AS alatbayar_text,
  d.nama          AS daftarbank_text,
  '<a target="_blank" className="link-color" href="/dashboard/jurnalumumheader?nobukti='
    || u.nobukti || '"><HighlightWrapper value="' || u.nobukti || '" /></a>' AS link
FROM pengeluaranheader u
LEFT JOIN relasi     r ON u.relasi_id     = r.id
LEFT JOIN bank       b ON u.bank_id       = b.id
LEFT JOIN akunpusat  a ON u.coakredit     = a.coa
LEFT JOIN alatbayar  c ON u.alatbayar_id  = c.id
LEFT JOIN daftarbank d ON u.daftarbank_id = d.id
WHERE (
  NULLIF(current_setting('tas.tgldari', true), '') IS NULL
  OR NULLIF(current_setting('tas.tglsampai', true), '') IS NULL
  -- NULLIF(...,'')::date, BUKAN CAST(... AS date): tgldari/tglsampai bisa berupa
  -- '' (string kosong) saat filter tanggal tidak aktif. SQL OR tidak dijamin
  -- short-circuit, jadi CAST tetap dievaluasi walau guard IS NULL true →
  -- CAST('' AS date) melempar "invalid input syntax for type date". NULLIF
  -- mengubah '' menjadi NULL sehingga ::date = NULL (aman, tidak melempar).
  OR u.tglbukti BETWEEN NULLIF(current_setting('tas.tgldari', true), '')::date
                    AND NULLIF(current_setting('tas.tglsampai', true), '')::date
)
AND (
  NULLIF(current_setting('tas.bank_id', true), '') IS NULL
  OR u.bank_id = current_setting('tas.bank_id', true)
);
