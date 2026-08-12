-- =====================================================================
-- View Biaya Extra (header + detail muatan)
--
-- Jalankan manual di pgAdmin pada database `tasemkl`, schema `public`.
-- Dipakai oleh BiayaExtraHeaderService (vbiayaextraheader) dan
-- BiayaExtraMuatanDetailService (vbiayaextramuatandetail,
-- vbiayaextramuatandetailorderan, vbiayaextrabyjob) — polanya sama
-- dengan vjurnalumumheader / vjurnalumumdetail.
--
-- Script ini idempotent: aman dijalankan ulang seluruhnya.
--
-- `vbiayaextraheader` sudah ada sebelumnya dengan tglbukti/created_at/
-- updated_at berupa teks TO_CHAR. Sekarang kolom itu dikembalikan mentah
-- supaya filter rentang tanggal bisa membandingkan timestamp, jadi view lama
-- HARUS di-drop dulu (CREATE OR REPLACE menolak perubahan tipe kolom).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. vbiayaextraheader
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.vbiayaextraheader;

CREATE VIEW public.vbiayaextraheader AS
SELECT
    u.id,
    u.nobukti,
    u.tglbukti,
    u.jenisorder_id,
    u.biayaemkl_id,
    u.keterangan,
    u.statusformat,
    u.info,
    u.modifiedby,
    u.created_at,
    u.updated_at,
    p.nama AS jenisorder_text,
    q.nama AS biayaemkl_text
FROM biayaextraheader u
LEFT JOIN jenisorder p ON u.jenisorder_id = p.id
LEFT JOIN biayaemkl  q ON u.biayaemkl_id  = q.id
WHERE (
        NULLIF(current_setting('tas.jenisorder_id', true), '') IS NULL
        OR u.jenisorder_id = current_setting('tas.jenisorder_id', true)
      )
  AND (
        NULLIF(current_setting('tas.tgldari', true), '') IS NULL
        OR u.tglbukti >= NULLIF(current_setting('tas.tgldari', true), '')::date
      )
  AND (
        -- tglbukti bertipe timestamptz (bukan date seperti jurnalumumheader),
        -- jadi batas atas memakai < hari+1; `<= tglsampai::date` akan membuang
        -- seluruh baris di hari terakhir yang jamnya bukan 00:00.
        NULLIF(current_setting('tas.tglsampai', true), '') IS NULL
        OR u.tglbukti < NULLIF(current_setting('tas.tglsampai', true), '')::date + INTERVAL '1 day'
      );

COMMENT ON VIEW public.vbiayaextraheader IS
  'Daftar biaya extra header + nama jenis order & biaya emkl. Dibaca BiayaExtraHeaderService (findAll/findOne/export).';

-- ---------------------------------------------------------------------
-- 2. vbiayaextramuatandetail
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.vbiayaextramuatandetail;

CREATE VIEW public.vbiayaextramuatandetail AS
SELECT
    p.id,
    p.biayaextra_id,
    p.nobukti,
    p.orderanmuatan_nobukti,
    p.estimasi,
    p.nominal,
    p.statustagih,
    s.text AS statustagih_text,
    s.memo AS statustagih_memo,
    p.nominaltagih,
    p.keterangan,
    p.groupbiayaextra_id,
    g.keterangan AS groupbiayaextra_text,
    p.info,
    p.modifiedby,
    TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') AS created_at,
    TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') AS updated_at,
    '<a target="_blank" className="link-color" href="/dashboard/biaya-extra-header'
      || CHR(63) || 'nobukti=' || p.nobukti
      || '"><HighlightWrapper value="' || p.nobukti || '" /></a>' AS link
FROM biayaextramuatandetail p
LEFT JOIN parameter        s ON p.statustagih         = s.id
LEFT JOIN groupbiayaextra  g ON p.groupbiayaextra_id  = g.id
-- Sama seperti vjurnalumumdetail: grid detail selalu dibatasi satu header,
-- service men-set `tas.biayaextra_id` sebelum query supaya baris milik header
-- lain tidak ikut terbaca.
WHERE NULLIF(current_setting('tas.biayaextra_id', true), '') IS NULL
   OR p.biayaextra_id = current_setting('tas.biayaextra_id', true);

COMMENT ON VIEW public.vbiayaextramuatandetail IS
  'Rincian muatan biaya extra + status tagih & group biaya extra. Dibaca BiayaExtraMuatanDetailService.';

-- ---------------------------------------------------------------------
-- 3. vbiayaextramuatandetailorderan
--
-- Rincian orderan (container/seal/shipper/lokasi stuffing) di balik tiap
-- baris detail. Dibaca BiayaExtraMuatanDetailService.findOne — dipakai
-- FormBiayaHeader saat menarik biaya extra ke dalam biaya header.
-- Memakai session context yang SAMA dengan vbiayaextramuatandetail
-- (`tas.biayaextra_id`) karena lingkupnya juga satu header.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.vbiayaextramuatandetailorderan;

CREATE VIEW public.vbiayaextramuatandetailorderan AS
SELECT
    p.id,
    p.biayaextra_id,
    p.nobukti,
    p.orderanmuatan_nobukti AS orderan_nobukti,
    p.estimasi,
    TO_CHAR(h.tglbukti, 'DD-MM-YYYY') AS tglbukti,
    m.id   AS orderan_id,
    m.nocontainer,
    m.noseal,
    t.keterangan AS lokasistuffing_nama,
    s.nama AS shipper_nama,
    c.nama AS container_nama
FROM biayaextramuatandetail p
LEFT JOIN orderanheader  h ON p.orderanmuatan_nobukti = h.nobukti
LEFT JOIN orderanmuatan  m ON h.id             = m.orderan_id
LEFT JOIN hargatrucking  t ON m.lokasistuffing = t.id
LEFT JOIN shipper        s ON m.shipper_id     = s.id
LEFT JOIN container      c ON m.container_id   = c.id
WHERE NULLIF(current_setting('tas.biayaextra_id', true), '') IS NULL
   OR p.biayaextra_id = current_setting('tas.biayaextra_id', true);

COMMENT ON VIEW public.vbiayaextramuatandetailorderan IS
  'Rincian orderan muatan di balik tiap baris biaya extra. Dibaca BiayaExtraMuatanDetailService.findOne.';

-- ---------------------------------------------------------------------
-- 4. vbiayaextrabyjob
--
-- Sumber lookup "BIAYA EXTRA" di FormBiayaLainLainDetailMuatan: baris detail
-- beserta jenisorder/biayaemkl headernya supaya lookup bisa memfilter per
-- jenis order + biaya emkl + job (orderanmuatan_nobukti).
-- LEFT JOIN dari header dipertahankan persis seperti query lamanya, jadi
-- header tanpa detail tetap muncul dengan kolom detail NULL.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.vbiayaextrabyjob;

CREATE VIEW public.vbiayaextrabyjob AS
SELECT
    d.id,
    d.nobukti,
    d.biayaextra_id,
    d.orderanmuatan_nobukti,
    d.estimasi,
    d.nominal,
    d.keterangan,
    u.jenisorder_id,
    u.biayaemkl_id,
    u.nobukti AS header_nobukti
FROM biayaextraheader u
LEFT JOIN biayaextramuatandetail d ON u.id = d.biayaextra_id;

COMMENT ON VIEW public.vbiayaextrabyjob IS
  'Baris biaya extra + jenis order & biaya emkl headernya. Dibaca BiayaExtraMuatanDetailService.biayaExraByJob (lookup BIAYA EXTRA).';

-- ---------------------------------------------------------------------
-- 5. Index penunjang (opsional, jalankan sekali)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_biayaextraheader_jenisorder_tglbukti
    ON public.biayaextraheader (jenisorder_id, tglbukti);

CREATE INDEX IF NOT EXISTS idx_biayaextraheader_biayaemkl_id
    ON public.biayaextraheader (biayaemkl_id);

CREATE INDEX IF NOT EXISTS idx_biayaextramuatandetail_biayaextra_id
    ON public.biayaextramuatandetail (biayaextra_id);

CREATE INDEX IF NOT EXISTS idx_biayaextramuatandetail_orderanmuatan_nobukti
    ON public.biayaextramuatandetail (orderanmuatan_nobukti);
