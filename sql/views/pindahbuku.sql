-- =====================================================================
-- View Pindah Buku
--
-- Jalankan manual di pgAdmin pada database `tasemkl`, schema `public`.
-- Dipakai oleh PindahBukuService (vpindahbuku) — polanya sama dengan
-- vbiayaextraheader / vjurnalumumheader.
--
-- Script ini idempotent: aman dijalankan ulang seluruhnya.
--
-- `vpindahbuku` sebelumnya mengembalikan tglbukti/tgljatuhtempo/created_at/
-- updated_at berupa teks TO_CHAR dan kolom relasi bernama `<x>_nama`. Sekarang
-- tanggal dikembalikan MENTAH (biar bisa diurutkan & dibandingkan sebagai
-- tanggal, bukan string DD-MM-YYYY) dan kolom relasi memakai akhiran `_text`
-- supaya namanya sama persis dengan key filter/sort yang dikirim grid.
-- Perubahan tipe kolom membuat CREATE OR REPLACE ditolak, jadi view lama HARUS
-- di-drop dulu.
-- =====================================================================

DROP VIEW IF EXISTS public.vpindahbuku;

CREATE VIEW public.vpindahbuku AS
SELECT
    u.id,
    u.nobukti,
    u.tglbukti,
    u.bankdari_id,
    u.bankke_id,
    u.coadebet,
    u.coakredit,
    u.alatbayar_id,
    u.nowarkat,
    u.tgljatuhtempo,
    u.keterangan,
    u.nominal,
    u.statusformat,
    u.info,
    u.modifiedby,
    u.created_at,
    u.updated_at,
    -- Nama bank & alat bayar diambil dari kolom `keterangan`, bukan `nama`:
    -- itu yang dipakai view lama dan yang tampil di grid.
    bankdari.keterangan     AS bankdari_text,
    bankke.keterangan       AS bankke_text,
    coadebet.keterangancoa  AS coadebet_text,
    coakredit.keterangancoa AS coakredit_text,
    p.keterangan            AS alatbayar_text,
    -- Tidak tampil di grid, tapi frontend mengirim key `statusformat_text` di
    -- daftar filternya sehingga ikut disapu kotak SEARCH — tanpa kolom ini
    -- query-nya gagal.
    sf.text                 AS statusformat_text
FROM pindahbuku u
LEFT JOIN bank      bankdari  ON u.bankdari_id  = bankdari.id
LEFT JOIN bank      bankke    ON u.bankke_id    = bankke.id
-- coadebet/coakredit menyimpan NOMOR coa (diambil dari bank.coa), bukan
-- akunpusat.id, jadi join-nya lewat kolom coa.
LEFT JOIN akunpusat coadebet  ON u.coadebet     = coadebet.coa
LEFT JOIN akunpusat coakredit ON u.coakredit    = coakredit.coa
LEFT JOIN alatbayar p         ON u.alatbayar_id = p.id
LEFT JOIN parameter sf        ON u.statusformat = sf.id
-- Tiap batas berdiri sendiri (bukan "kalau dua-duanya ada" seperti view lama),
-- sama seperti vbiayaextraheader: service selalu men-set kedua GUC secara
-- eksplisit, jadi batas yang kosong dikirim sebagai '' dan tidak menyaring.
WHERE (
        NULLIF(current_setting('tas.tgldari', true), '') IS NULL
        OR u.tglbukti >= NULLIF(current_setting('tas.tgldari', true), '')::date
      )
  AND (
        -- Batas atas ditulis `< hari+1` supaya tetap benar kalau tglbukti
        -- kelak jadi timestamp: `<= tglsampai::date` akan membuang baris hari
        -- terakhir yang jamnya bukan 00:00.
        NULLIF(current_setting('tas.tglsampai', true), '') IS NULL
        OR u.tglbukti < NULLIF(current_setting('tas.tglsampai', true), '')::date + INTERVAL '1 day'
      );

ALTER TABLE public.vpindahbuku OWNER TO app_emkl;

COMMENT ON VIEW public.vpindahbuku IS
  'Pindah buku + nama bank asal/tujuan, coa debet/kredit, alat bayar & status format. Dibaca PindahBukuService (findAll/findOne/report/export).';

-- ---------------------------------------------------------------------
-- Index penunjang (opsional, jalankan sekali)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pindahbuku_tglbukti
    ON public.pindahbuku (tglbukti);

CREATE INDEX IF NOT EXISTS idx_pindahbuku_nobukti
    ON public.pindahbuku (nobukti);
