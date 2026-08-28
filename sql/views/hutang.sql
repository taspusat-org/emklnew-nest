-- =====================================================================
-- View Hutang (header + detail)
--
-- Jalankan manual di pgAdmin pada database `tasemkl`, schema `public`.
-- Dipakai oleh HutangheaderService (vhutangheader) dan HutangdetailService
-- (vhutangdetail) — polanya sama dengan vjurnalumumheader / vjurnalumumdetail.
--
-- Script ini idempotent: aman dijalankan ulang seluruhnya. Daftar kolom tidak
-- berubah, jadi CREATE OR REPLACE cukup (tanpa DROP).
--
-- Perubahan dibanding versi sebelumnya:
--   1. vhutangheader TIDAK lagi memangkas relasi_id lewat
--      current_setting('tas.hutang_relasi_id'). Relasi adalah filter grid
--      biasa, jadi predikatnya dipasang di applyFilters() supaya berlaku sama
--      di semua jalur — termasuk export yang berjalan tanpa transaksi, di mana
--      set_config(..., true) tidak berumur.
--   2. vhutangdetail memangkas satu bukti lewat
--      current_setting('tas.hutang_nobukti'), sehingga detail tersaring SEBELUM
--      LEFT JOIN akunpusat. Namanya ber-prefix `hutang_` (bukan `tas.nobukti`
--      milik vjurnalumumdetail/vkasgantungdetail) supaya tidak bertabrakan di
--      transaksi yang menyentuh dua modul sekaligus.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. vhutangheader
-- ---------------------------------------------------------------------
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
    r.nama AS relasi_text,
    a.keterangancoa AS coa_text,
    '<a target="_blank" className="link-color" href="/dashboard/jurnalumumheader'
      || chr(63) || 'nobukti=' || u.nobukti
      || '"><HighlightWrapper value="' || u.nobukti || '" /></a>' AS link
FROM hutangheader u
    LEFT JOIN relasi r ON u.relasi_id = r.id
    LEFT JOIN akunpusat a ON u.coa = a.coa
WHERE (
        NULLIF(current_setting('tas.hutang_tgldari', true), '') IS NULL
     OR NULLIF(current_setting('tas.hutang_tglsampai', true), '') IS NULL
     OR (
            u.tglbukti >= NULLIF(current_setting('tas.hutang_tgldari', true), '')::date
        AND u.tglbukti <= NULLIF(current_setting('tas.hutang_tglsampai', true), '')::date
        )
      );

ALTER TABLE public.vhutangheader OWNER TO app_emkl;

-- ---------------------------------------------------------------------
-- 2. vhutangdetail
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vhutangdetail AS
SELECT
    p.id,
    p.hutang_id,
    p.nobukti,
    p.coa,
    p.keterangan,
    p.nominal,
    p.dpp,
    p.noinvoiceemkl,
    CASE
        WHEN p.tglinvoiceemkl ~ '^\d{4}-\d{2}-\d{2}' THEN to_date("left"(p.tglinvoiceemkl, 10), 'YYYY-MM-DD')
        WHEN p.tglinvoiceemkl ~ '^\d{2}-\d{2}-\d{4}$' THEN to_date(p.tglinvoiceemkl, 'DD-MM-YYYY')
        ELSE NULL::date
    END AS tglinvoiceemkl,
    p.nofakturpajakemkl,
    p.info,
    p.modifiedby,
    p.created_at,
    p.updated_at,
    q.keterangancoa AS coa_text,
    '<a target="_blank" className="link-color" href="/dashboard/hutang'
      || chr(63) || 'nobukti=' || p.nobukti
      || '"><HighlightWrapper value="' || p.nobukti || '" /></a>' AS link
FROM hutangdetail p
    LEFT JOIN akunpusat q ON p.coa = q.coa
WHERE NULLIF(current_setting('tas.hutang_nobukti', true), '') IS NULL
   OR p.nobukti = current_setting('tas.hutang_nobukti', true);

ALTER TABLE public.vhutangdetail OWNER TO app_emkl;
