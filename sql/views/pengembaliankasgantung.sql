-- =====================================================================
-- View Pengembalian Kas Gantung (header + detail)
--
-- Jalankan manual di pgAdmin pada database `tasemkl`, schema `public`.
-- Dipakai oleh PengembaliankasgantungheaderService
-- (vpengembaliankasgantungheader) dan PengembaliankasgantungdetailService
-- (vpengembaliankasgantungdetail) — polanya sama dengan vjurnalumumheader /
-- vjurnalumumdetail dan vpenerimaanheader / vpenerimaandetail.
--
-- Script ini idempotent: aman dijalankan ulang seluruhnya.
--
-- Sebelum ini modul pengembalian kas gantung membaca tabel base lalu membangun
-- JOIN + kolom `link` lewat temp table `##temp_...` + STRING_AGG bergaya SQL
-- Server di tiap request. Dipindah ke view supaya windowed pagination (grid
-- menarik 5 halaman sekaligus) tidak membayar JOIN + agregasi berulang.
--
-- Nama GUC-nya ber-prefix `pengembaliankasgantung_` (BUKAN `tas.tgldari`
-- milik penerimaan/pengeluaran/jurnal umum): create/update di modul ini
-- memanggil PenerimaanheaderService di TRANSAKSI YANG SAMA, dan penerimaan
-- men-set `tas.tgldari`/`tas.tglsampai`/`tas.bank_id` untuk gridnya sendiri.
-- Kalau namanya dipakai bersama, periode salah satu modul akan memangkas
-- baris modul lainnya. Lihat `tas.hutang_nobukti` di hutang.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. vpengembaliankasgantungheader
--
-- Periode dan bank diturunkan lewat GUC, bukan sebagai predikat di query
-- luar: view memangkas pengembaliankasgantungheader SEBELUM LEFT JOIN
-- relasi/bank/akunpusat/alatbayar/parameter.
--
-- `set_config(..., true)` hanya hidup selama transaksi — jalur tanpa trx
-- (report/export background) menyaring per id/nobukti sendiri, jadi tidak
-- terpengaruh.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.vpengembaliankasgantungheader;

CREATE VIEW public.vpengembaliankasgantungheader AS
SELECT
    u.id,
    u.nobukti,
    u.tglbukti,
    u.keterangan,
    u.bank_id,
    u.penerimaan_nobukti,
    u.coakasmasuk,
    u.relasi_id,
    u.alatbayar_id,
    u.statusformat,
    u.info,
    u.modifiedby,
    u.created_at,
    u.updated_at,
    r.nama           AS relasi_text,
    b.nama           AS bank_text,
    ap.keterangancoa AS coakasmasuk_text,
    ab.nama          AS alatbayar_text,
    -- Tidak tampil di grid, tapi frontend mengirim key `statusformat_text` di
    -- daftar filternya sehingga ikut disapu kotak SEARCH — tanpa kolom ini
    -- query-nya gagal.
    sf.text          AS statusformat_text,
    -- Link ke bukti penerimaan yang dibentuk otomatis oleh modul ini.
    -- Baris tanpa penerimaan_nobukti dibiarkan NULL supaya grid tidak
    -- menampilkan anchor kosong.
    CASE
        WHEN NULLIF(u.penerimaan_nobukti, '') IS NULL THEN NULL
        ELSE '<a target="_blank" className="link-color" href="/dashboard/penerimaan'
             || CHR(63) || 'penerimaan_nobukti=' || u.penerimaan_nobukti
             || '"><HighlightWrapper value="' || u.penerimaan_nobukti || '" /></a>'
    END AS link
FROM pengembaliankasgantungheader u
LEFT JOIN relasi    r  ON u.relasi_id    = r.id
LEFT JOIN bank      b  ON u.bank_id      = b.id
-- coakasmasuk menyimpan NOMOR coa (diambil dari bank.coa), bukan akunpusat.id.
LEFT JOIN akunpusat ap ON u.coakasmasuk  = ap.coa
LEFT JOIN alatbayar ab ON u.alatbayar_id = ab.id
LEFT JOIN parameter sf ON u.statusformat = sf.id
-- Tiap batas berdiri sendiri: service selalu men-set kedua GUC secara
-- eksplisit, jadi batas yang kosong dikirim sebagai '' dan tidak menyaring.
WHERE (
        NULLIF(current_setting('tas.pengembaliankasgantung_tgldari', true), '') IS NULL
        OR u.tglbukti >= NULLIF(current_setting('tas.pengembaliankasgantung_tgldari', true), '')::date
      )
  AND (
        -- Batas atas ditulis `< hari+1` supaya tetap benar kalau tglbukti
        -- kelak jadi timestamp: `<= tglsampai::date` membuang baris hari
        -- terakhir yang jamnya bukan 00:00.
        NULLIF(current_setting('tas.pengembaliankasgantung_tglsampai', true), '') IS NULL
        OR u.tglbukti < NULLIF(current_setting('tas.pengembaliankasgantung_tglsampai', true), '')::date + INTERVAL '1 day'
      )
  AND (
        NULLIF(current_setting('tas.pengembaliankasgantung_bank_id', true), '') IS NULL
        OR u.bank_id = current_setting('tas.pengembaliankasgantung_bank_id', true)
      );

ALTER TABLE public.vpengembaliankasgantungheader OWNER TO app_emkl;

COMMENT ON VIEW public.vpengembaliankasgantungheader IS
  'Pengembalian kas gantung header + nama relasi/bank/coa kas masuk/alat bayar & link penerimaan. Dibaca PengembaliankasgantungheaderService (findAll/findOne/report/export).';

-- ---------------------------------------------------------------------
-- 2. vpengembaliankasgantungdetail
--
-- Dipangkas satu bukti lewat `tas.pengembaliankasgantung_nobukti` supaya
-- rincian tersaring SEBELUM LEFT JOIN kasgantungheader — sama seperti
-- vhutangdetail.
--
-- `nominal` dikembalikan APA ADANYA (bukan ABS seperti vjurnalumumdetail):
-- pengembalian kas gantung tidak memecah debet/kredit.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.vpengembaliankasgantungdetail;

CREATE VIEW public.vpengembaliankasgantungdetail AS
SELECT
    p.id,
    p.pengembaliankasgantung_id,
    p.nobukti,
    p.kasgantung_nobukti,
    p.keterangan,
    p.nominal,
    p.penerimaandetail_id,
    p.info,
    p.modifiedby,
    p.created_at,
    p.updated_at,
    -- Keterangan bukti kas gantung yang dikembalikan: grid detail
    -- menampilkannya di samping nomor buktinya.
    kg.keterangan AS kasgantung_keterangan,
    kg.tglbukti   AS kasgantung_tglbukti,
    '<a target="_blank" className="link-color" href="/dashboard/kasgantung'
      || CHR(63) || 'nobukti=' || p.kasgantung_nobukti
      || '"><HighlightWrapper value="' || p.kasgantung_nobukti || '" /></a>' AS link
FROM pengembaliankasgantungdetail p
LEFT JOIN kasgantungheader kg ON p.kasgantung_nobukti = kg.nobukti
WHERE NULLIF(current_setting('tas.pengembaliankasgantung_nobukti', true), '') IS NULL
   OR p.nobukti = current_setting('tas.pengembaliankasgantung_nobukti', true);

ALTER TABLE public.vpengembaliankasgantungdetail OWNER TO app_emkl;

COMMENT ON VIEW public.vpengembaliankasgantungdetail IS
  'Rincian pengembalian kas gantung + keterangan bukti kas gantung & link-nya. Dibaca PengembaliankasgantungdetailService.';

-- ---------------------------------------------------------------------
-- 3. Index penunjang (opsional, jalankan sekali)
--
-- tglbukti/nobukti menopang filter periode + sort default grid; kolom FK
-- detail menopang JOIN ke header dan penghapusan per-header di delete().
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pengembaliankasgantungheader_tglbukti
    ON public.pengembaliankasgantungheader (tglbukti);

CREATE INDEX IF NOT EXISTS idx_pengembaliankasgantungheader_nobukti
    ON public.pengembaliankasgantungheader (nobukti);

CREATE INDEX IF NOT EXISTS idx_pengembaliankasgantungheader_bank_id
    ON public.pengembaliankasgantungheader (bank_id);

CREATE INDEX IF NOT EXISTS idx_pengembaliankasgantungheader_penerimaan_nobukti
    ON public.pengembaliankasgantungheader (penerimaan_nobukti);

CREATE INDEX IF NOT EXISTS idx_pengembaliankasgantungdetail_nobukti
    ON public.pengembaliankasgantungdetail (nobukti);

CREATE INDEX IF NOT EXISTS idx_pengembaliankasgantungdetail_header_id
    ON public.pengembaliankasgantungdetail (pengembaliankasgantung_id);

CREATE INDEX IF NOT EXISTS idx_pengembaliankasgantungdetail_kasgantung_nobukti
    ON public.pengembaliankasgantungdetail (kasgantung_nobukti);
