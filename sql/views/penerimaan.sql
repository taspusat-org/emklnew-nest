-- =====================================================================
-- View Penerimaan (header + detail)
--
-- Jalankan manual di pgAdmin pada database `tasemkl`, schema `public`.
-- Dipakai oleh PenerimaanheaderService (vpenerimaanheader) dan
-- PenerimaandetailService (vpenerimaandetail) — polanya sama persis dengan
-- vpengeluaranheader / vpengeluarandetail.
--
-- Script ini idempotent: aman dijalankan ulang seluruhnya.
--
-- Sebelum ini modul penerimaan membaca tabel base lalu membangun JOIN + kolom
-- `link` lewat temp table `##temp_...` + STRING_AGG bergaya SQL Server di tiap
-- request. Dipindah ke view supaya windowed pagination (grid menarik 5 halaman
-- sekaligus) tidak membayar JOIN + agregasi berulang.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. vpenerimaanheader
--
-- Periode dan bank diturunkan lewat GUC (`tas.tgldari`, `tas.tglsampai`,
-- `tas.bank_id`), bukan sebagai predikat di query luar: view menyaring
-- penerimaanheader SEBELUM LEFT JOIN relasi/bank/akunpusat/alatbayar.
--
-- `set_config(..., true)` hanya hidup selama transaksi — jalur tanpa trx
-- (export background) memasang predikatnya sendiri lewat applyPeriodFilters.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.vpenerimaanheader;

CREATE VIEW public.vpenerimaanheader AS
SELECT
    u.id,
    u.nobukti,
    u.tglbukti,
    u.relasi_id,
    u.keterangan,
    u.bank_id,
    u.postingdari,
    u.coakasmasuk,
    u.diterimadari,
    u.alatbayar_id,
    u.nowarkat,
    u.tgllunas,
    u.noresi,
    u.statusformat,
    u.info,
    u.modifiedby,
    u.created_at,
    u.updated_at,
    r.nama          AS relasi_text,
    b.nama          AS bank_text,
    ap.keterangancoa AS coakasmasuk_text,
    ab.nama         AS alatbayar_text,
    '<a target="_blank" className="link-color" href="/dashboard/jurnalumumheader'
      || CHR(63) || 'nobukti=' || u.nobukti
      || '"><HighlightWrapper value="' || u.nobukti || '" /></a>' AS link
FROM penerimaanheader u
LEFT JOIN relasi    r  ON u.relasi_id    = r.id
LEFT JOIN bank      b  ON u.bank_id      = b.id
-- coakasmasuk menyimpan NOMOR coa (diambil dari bank.coa), bukan akunpusat.id.
LEFT JOIN akunpusat ap ON u.coakasmasuk  = ap.coa
LEFT JOIN alatbayar ab ON u.alatbayar_id = ab.id
WHERE (
        NULLIF(current_setting('tas.tgldari', true), '') IS NULL
        OR u.tglbukti >= NULLIF(current_setting('tas.tgldari', true), '')::date
      )
  AND (
        -- Batas atas `< hari+1` supaya tetap benar kalau tglbukti kelak jadi
        -- timestamp: `<= tglsampai::date` membuang baris hari terakhir yang
        -- jamnya bukan 00:00.
        NULLIF(current_setting('tas.tglsampai', true), '') IS NULL
        OR u.tglbukti < NULLIF(current_setting('tas.tglsampai', true), '')::date + INTERVAL '1 day'
      )
  AND (
        NULLIF(current_setting('tas.bank_id', true), '') IS NULL
        OR u.bank_id = current_setting('tas.bank_id', true)
      );

COMMENT ON VIEW public.vpenerimaanheader IS
  'Penerimaan header + nama relasi/bank/coa kas masuk/alat bayar & link jurnal. Dibaca PenerimaanheaderService (findAll/export).';

-- ---------------------------------------------------------------------
-- 2. vpenerimaandetail
--
-- Tidak memakai GUC: grid detail selalu dibatasi satu nobukti oleh
-- pemanggilnya, sama seperti vpengeluarandetail.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.vpenerimaandetail;

CREATE VIEW public.vpenerimaandetail AS
SELECT
    p.id,
    p.penerimaan_id,
    p.nobukti,
    p.coa,
    ap.keterangancoa AS coa_text,
    p.keterangan,
    p.nominal,
    p.transaksibiaya_nobukti,
    p.transaksilain_nobukti,
    p.pengeluaranemklheader_nobukti,
    p.penerimaanemklheader_nobukti,
    p.pengembaliankasgantung_nobukti,
    p.info,
    p.modifiedby,
    p.created_at,
    p.updated_at,
    '<a target="_blank" className="link-color" href="/dashboard/jurnalumumheader'
      || CHR(63) || 'nobukti=' || p.nobukti
      || '"><HighlightWrapper value="' || p.nobukti || '" /></a>' AS link
FROM penerimaandetail p
LEFT JOIN akunpusat ap ON p.coa = ap.coa;

COMMENT ON VIEW public.vpenerimaandetail IS
  'Rincian penerimaan + keterangan coa & link jurnal. Dibaca PenerimaandetailService.';

-- ---------------------------------------------------------------------
-- 3. Index
--
-- Dipindah ke `penerimaan-indexes.sql`: daftarnya jauh lebih panjang dari
-- sekadar dua tabel penerimaan (sisi master yang di-join juga tidak punya
-- index) dan sebagiannya perlu pemeriksaan duplikat lebih dulu.
-- ---------------------------------------------------------------------
