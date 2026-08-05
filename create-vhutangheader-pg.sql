/*
  vhutangheader — port arsitektur vpengeluaranheader ke modul hutang.

  Konteks: HutangheaderService.findAll() sebelumnya membangun tabel temp
  `##temp_url_xxx` per request lalu STRING_AGG dengan operator `+` — keduanya
  sintaks SQL Server, bukan Postgres (DB tasemkl adalah PG; `dbMssql` cuma nama
  variabel). Selain tidak jalan, membangun temp table + JOIN relasi/akunpusat di
  setiap request membuat windowed pagination (grid menarik 5 halaman sekaligus)
  jadi mahal.

  View ini menyamakan hutang dengan pengeluaran:
    - relasi_text & coa_text jadi kolom view, bukan hasil JOIN ad-hoc, sehingga
      filter/search grid pada kolom turunan ikut terhitung benar oleh COUNT.
    - `link` di-inline (nobukti unik → setara CTE STRING_AGG yang lama).
    - Filter tanggal dibaca dari GUC per-transaksi yang di-set service lewat
      set_config('tas.hutang_*', value, true). Prefix `tas.hutang_` sengaja
      dipakai (bukan `tas.tgldari` milik vpengeluaranheader) supaya satu
      transaksi yang menyentuh dua view tidak saling menimpa filter.
*/
CREATE OR REPLACE VIEW public.vhutangheader AS
SELECT
  u.id,
  u.nobukti,
  u.tglbukti,
  u.tgljatuhtempo,
  u.keterangan,
  u.relasi_id,
  u.coa,
  u.statusformat,
  u.info,
  u.modifiedby,
  u.created_at,
  u.updated_at,
  r.nama          AS relasi_text,
  a.keterangancoa AS coa_text,
  -- chr(63) = '?', BUKAN literal '?': file ini juga dijalankan lewat knex.raw
  -- yang memperlakukan '?' sebagai placeholder binding positional. Sama dengan
  -- vpengeluaranheader.
  '<a target="_blank" className="link-color" href="/dashboard/jurnalumumheader'
    || chr(63) || 'nobukti=' || u.nobukti
    || '"><HighlightWrapper value="' || u.nobukti || '" /></a>' AS link
FROM hutangheader u
LEFT JOIN relasi    r ON u.relasi_id = r.id
LEFT JOIN akunpusat a ON u.coa       = a.coa
WHERE (
  NULLIF(current_setting('tas.hutang_tgldari', true), '') IS NULL
  OR NULLIF(current_setting('tas.hutang_tglsampai', true), '') IS NULL
  -- NULLIF(...,'')::date, BUKAN CAST(... AS date): nilainya bisa '' saat filter
  -- tanggal tidak aktif. SQL OR tidak dijamin short-circuit, jadi CAST tetap
  -- dievaluasi walau guard IS NULL true → CAST('' AS date) melempar "invalid
  -- input syntax for type date". NULLIF mengubah '' jadi NULL (aman).
  OR u.tglbukti BETWEEN NULLIF(current_setting('tas.hutang_tgldari', true), '')::date
                    AND NULLIF(current_setting('tas.hutang_tglsampai', true), '')::date
)
AND (
  NULLIF(current_setting('tas.hutang_relasi_id', true), '') IS NULL
  OR u.relasi_id = current_setting('tas.hutang_relasi_id', true)
);
