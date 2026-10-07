-- =====================================================================
-- SEED pengembalian kas gantung
--   - 5.000 header, tglbukti = HARI INI (CURRENT_DATE)
--   - 1.000 detail, semuanya menempel di header PERTAMA (suffix 00001)
--
-- Jalankan di pgAdmin pada database `tasemkl`.
--
-- Nomor bukti sengaja diberi prefix 'SEED/PKG/' dan BUKAN format running
-- number asli (parameter.text milik bank.formatpenerimaangantung). Kalau
-- memakai format asli, RunningNumberService.findNumberSlot() akan ikut
-- menghitung 5.000 baris dummy ini sebagai nomor terpakai, dan create()
-- berikutnya melanjutkan nomor dari situ. Dengan prefix SEED, regex
-- pattern-nya tidak match sehingga penomoran asli tidak tersentuh.
--
-- Bukti PENERIMAAN pasangannya tidak dibuat (create() asli membuatnya lewat
-- PenerimaanheaderService). `penerimaan_nobukti` diisi NULL, BUKAN '' —
-- ada FK ke penerimaanheader.nobukti dan FK hanya melewatkan NULL, string
-- kosong tetap dicari di tabel tujuan (SQLSTATE 23503). Efeknya sama:
-- kolom `link` di view bernilai NULL, bukan anchor ke bukti yang tidak ada.
--
-- Hapus ulang: lihat blok CLEANUP di bagian bawah file.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. HEADER — 5.000 baris
--
-- bank/relasi/alatbayar diambil dari master yang benar-benar ada supaya
-- LEFT JOIN di vpengembaliankasgantungheader menghasilkan *_text terisi.
-- coakasmasuk mengikuti bank.coa dan statusformat mengikuti
-- bank.formatpenerimaangantung, sama seperti yang ditulis service.
-- ---------------------------------------------------------------------
WITH bk AS (
  -- coa-nya wajib ada di akunpusat: selain menghindari FK coakasmasuk,
  -- ini yang bikin kolom coakasmasuk_text di view ikut terisi.
  SELECT b.id, b.coa, b.formatpenerimaangantung
  FROM bank b
  WHERE b.formatpenerimaangantung IS NOT NULL
    AND EXISTS (SELECT 1 FROM akunpusat ap WHERE ap.coa = b.coa)
  ORDER BY b.id
  LIMIT 1
),
cab AS (
  SELECT COALESCE(
    (SELECT memo::jsonb ->> 'KODE CABANG'
       FROM parameter
      WHERE grp = 'CABANG' AND subgrp = 'CABANG'
      LIMIT 1),
    '00'
  ) AS kode
),
rel AS (
  SELECT array_agg(id) AS ids
  FROM (SELECT id FROM relasi ORDER BY id LIMIT 200) t
),
ab AS (
  SELECT array_agg(id) AS ids
  FROM (SELECT id FROM alatbayar ORDER BY id LIMIT 50) t
)
INSERT INTO pengembaliankasgantungheader
  (id, nobukti, tglbukti, keterangan, bank_id, penerimaan_nobukti,
   coakasmasuk, relasi_id, alatbayar_id, statusformat, info, modifiedby,
   created_at, updated_at)
SELECT
  upper(cab.kode || '-' || public.get_uuid_v7()::text),
  'SEED/PKG/' || to_char(CURRENT_DATE, 'YYYYMMDD') || '/' || lpad(g::text, 5, '0'),
  CURRENT_DATE,
  'SEED PENGEMBALIAN KAS GANTUNG ' || g,
  bk.id,
  NULL,
  bk.coa,
  rel.ids[1 + (g % array_length(rel.ids, 1))],
  ab.ids[1 + (g % array_length(ab.ids, 1))],
  bk.formatpenerimaangantung,
  'SEED',
  'SEED',
  now(),
  now()
FROM generate_series(1, 5000) AS g
CROSS JOIN cab
CROSS JOIN rel
CROSS JOIN ab
LEFT JOIN bk ON true;

-- ---------------------------------------------------------------------
-- 2. DETAIL — 1.000 baris, semua di header pertama
--
-- kasgantung_nobukti diputar dari kasgantungheader yang ada supaya
-- vpengembaliankasgantungdetail bisa mengisi kasgantung_keterangan dan
-- kasgantung_tglbukti. Kalau tabel kasgantungheader kosong, kolomnya diisi
-- NULL (bukan nomor dummy) karena ada FK ke kasgantungheader.nobukti.
-- ---------------------------------------------------------------------
WITH hdr AS (
  SELECT id, nobukti
  FROM pengembaliankasgantungheader
  WHERE nobukti = 'SEED/PKG/' || to_char(CURRENT_DATE, 'YYYYMMDD') || '/00001'
),
cab AS (
  SELECT COALESCE(
    (SELECT memo::jsonb ->> 'KODE CABANG'
       FROM parameter
      WHERE grp = 'CABANG' AND subgrp = 'CABANG'
      LIMIT 1),
    '00'
  ) AS kode
),
kg AS (
  SELECT array_agg(nobukti) AS nos
  FROM (
    SELECT nobukti
    FROM kasgantungheader
    ORDER BY tglbukti DESC, nobukti DESC
    LIMIT 500
  ) t
)
INSERT INTO pengembaliankasgantungdetail
  (id, pengembaliankasgantung_id, nobukti, kasgantung_nobukti, keterangan,
   nominal, penerimaandetail_id, info, modifiedby, created_at, updated_at)
SELECT
  upper(cab.kode || '-' || public.get_uuid_v7()::text),
  hdr.id,
  hdr.nobukti,
  kg.nos[1 + (g % array_length(kg.nos, 1))],
  'SEED RINCIAN ' || g,
  (100000 + (g % 900) * 1000)::numeric::money,
  NULL,
  'SEED',
  'SEED',
  now(),
  now()
FROM generate_series(1, 1000) AS g
CROSS JOIN hdr
CROSS JOIN cab
CROSS JOIN kg;

COMMIT;

-- ---------------------------------------------------------------------
-- 3. VERIFIKASI
-- ---------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM pengembaliankasgantungheader
    WHERE nobukti LIKE 'SEED/PKG/' || to_char(CURRENT_DATE, 'YYYYMMDD') || '/%') AS total_header,
  (SELECT count(*) FROM pengembaliankasgantungdetail
    WHERE nobukti = 'SEED/PKG/' || to_char(CURRENT_DATE, 'YYYYMMDD') || '/00001') AS detail_header_pertama;

-- ---------------------------------------------------------------------
-- 4. CLEANUP (jalankan manual kalau data seed mau dibuang)
-- ---------------------------------------------------------------------
-- BEGIN;
-- DELETE FROM pengembaliankasgantungdetail WHERE nobukti LIKE 'SEED/PKG/%';
-- DELETE FROM pengembaliankasgantungheader WHERE nobukti LIKE 'SEED/PKG/%';
-- COMMIT;

-- ---------------------------------------------------------------------
-- 5. Daftar FK kedua tabel (dipakai kalau muncul lagi error 23503).
--    Foreign key-nya tidak ada di folder migrations, jadi hanya bisa
--    dilihat langsung dari katalog.
-- ---------------------------------------------------------------------
-- SELECT conrelid::regclass AS tabel, conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE contype = 'f'
--    AND conrelid::regclass::text IN ('pengembaliankasgantungheader',
--                                     'pengembaliankasgantungdetail')
--  ORDER BY 1, 2;
