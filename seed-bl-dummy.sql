/*
  ============================================================================
  SEED DATA DUMMY BL — untuk menguji lazy loading / windowed paging
  ============================================================================
  Target DB : Postgres (schema public)
  Jalankan  : psql -d <db> -f seed-bl-dummy.sql

  Isi:
    BAGIAN 1 — 1.000 baris blheader, tglbukti tersebar di BULAN BERJALAN
               (dihitung dari CURRENT_DATE, jadi tidak perlu diedit tiap ganti
               bulan).
    BAGIAN 2 — 1.000 baris bldetail untuk BL PALING ATAS di bulan itu
               ('BL 0001/<romawi>/<tahun>').
    BAGIAN 3 — 1.000 baris bldetailrincian untuk DETAIL paling atas milik BL
               tersebut ('SEED BL 0001').

  Catatan penting:
    - `id` memakai '<kode cabang>-' || public.get_uuid_v7(). Fungsi itu VOLATILE
      sehingga dievaluasi per baris. Kalau dipakai fungsi STABLE/IMMUTABLE,
      Postgres boleh mengevaluasi sekali saja dan seluruh baris akan bertabrakan
      di PRIMARY KEY.
    - Format nobukti mengikuti parameter NOMOR BL yang aktif: `#BL #9999#/#R#/#Y`
      -> 'BL 0001/VIII/2026'. Nomor urut seed dimulai SETELAH nomor terbesar
      yang sudah ada di bulan yang sama, jadi script ini aman dijalankan
      berulang tanpa menghasilkan nobukti kembar.
    - FK yang aktif dan karena itu TIDAK di-hardcode — semuanya diambil dari
      baris master yang benar-benar ada:
        blheader.schedule_id                 -> schedulekapal(id)
        blheader.statusformat                -> parameter(id)
        blheader.shippinginstruction_nobukti -> shippinginstructionheader(nobukti)
        bldetail.bl_id                       -> blheader(id)
        bldetailrincian.bldetail_id          -> bldetail(id)
        bldetailrincian.orderanmuatan_nobukti-> orderanmuatan(nobukti)
      Nilai statusformat diambil dari parameter NOMOR BL / kelompok 'BL' —
      sama seperti yang dipakai BlHeaderService.create(), bukan kode karangan.
    - bldetail.shippinginstructiondetail_nobukti TIDAK punya FK, tapi tetap
      diisi nobukti SI detail yang benar-benar ada: kolom asalpelabuhan,
      consignee, shipper, comodity, notifyparty, dan STATUS PISAH BL di grid
      detail BL berasal dari join ke shippinginstructiondetail lewat kolom ini
      (lihat view vbldetail). Diisi karangan = kolom-kolom itu kosong di layar.
    - Grid BL membaca lewat view vblheader yang menyaring GUC tas.bl_tgldari /
      tas.bl_tglsampai. Supaya data ini kelihatan: pilih PERIODE = bulan
      berjalan.
    - Semua baris seed ditandai `modifiedby = 'seed'` (bukan lewat nobukti,
      supaya format nobukti tetap realistis). Itu penanda untuk menghapusnya
      lagi — lihat blok paling bawah.

  Ganti skala: ubah angka di `generate_series(1, 1000)` di tiap bagian.
*/

-- ============================================================================
-- BAGIAN 1 — 1.000 HEADER, TGLBUKTI = BULAN BERJALAN
-- ============================================================================
BEGIN;

INSERT INTO blheader (
  id, nobukti, tglbukti, schedule_id, statusformat, tglberangkat,
  shippinginstruction_nobukti, info, modifiedby, created_at, updated_at
)
WITH ref AS (
  SELECT
    COALESCE(
      (SELECT memo::jsonb ->> 'KODE CABANG'
         FROM parameter WHERE grp = 'CABANG' AND subgrp = 'CABANG' LIMIT 1),
      '02'
    )                                                          AS kode_cabang,
    date_trunc('month', CURRENT_DATE)::date                    AS awal_bulan,
    EXTRACT(
      day FROM (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')
    )::int                                                     AS jml_hari,
    -- #R# pada format nobukti = bulan dalam angka romawi.
    (ARRAY['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'])[
      EXTRACT(month FROM CURRENT_DATE)::int
    ]                                                          AS bulan_romawi,
    EXTRACT(year FROM CURRENT_DATE)::int                       AS tahun,
    (SELECT id FROM parameter
       WHERE grp = 'NOMOR BL' AND kelompok = 'BL'
       LIMIT 1)                                                AS statusformat
),
-- Nomor urut terbesar yang sudah dipakai di bulan yang sama. Seed lanjut dari
-- sini supaya bisa dijalankan berulang tanpa nobukti kembar.
nomor_awal AS (
  SELECT COALESCE(
           max((regexp_match(h.nobukti, '^BL ([0-9]+)/'))[1]::int),
           0
         ) AS last_no
  FROM blheader h
  CROSS JOIN ref r
  WHERE h.nobukti LIKE 'BL %/' || r.bulan_romawi || '/' || r.tahun
),
-- Jadwal kapal diputar bergantian supaya kolom VOY / PELAYARAN / KAPAL /
-- TUJUAN KAPAL di grid tidak seragam (semuanya turunan schedule_id).
jadwal AS (
  SELECT id, (row_number() OVER (ORDER BY id) - 1) AS rn, count(*) OVER () AS n
  FROM schedulekapal
),
-- shippinginstruction_nobukti punya FK — nobukti SI yang ada diputar juga.
si AS (
  SELECT nobukti,
         (row_number() OVER (ORDER BY nobukti) - 1) AS rn,
         count(*) OVER ()                           AS n
  FROM shippinginstructionheader
)
SELECT
  ref.kode_cabang || '-' || public.get_uuid_v7()::text,
  'BL ' || lpad((nomor_awal.last_no + g)::text, 4, '0')
        || '/' || ref.bulan_romawi
        || '/' || ref.tahun,
  -- Sebar merata ke seluruh hari di bulan berjalan.
  ref.awal_bulan + ((g - 1) % ref.jml_hari),
  j.id,
  ref.statusformat,
  -- Berangkat beberapa hari setelah tgl bukti, tetap di sekitar bulan berjalan.
  ref.awal_bulan + ((g - 1) % ref.jml_hari) + ((g % 5) + 1),
  s.nobukti,
  NULL,
  'seed',
  now(),
  now()
FROM generate_series(1, 1000) AS g
CROSS JOIN ref
CROSS JOIN nomor_awal
-- LEFT JOIN: kalau tabel master kosong, kolomnya cukup NULL (nullable), bukan
-- menggagalkan seluruh insert.
LEFT JOIN jadwal j ON j.rn = (g - 1) % NULLIF(j.n, 0)
LEFT JOIN si     s ON s.rn = (g - 1) % NULLIF(s.n, 0);

COMMIT;

-- ============================================================================
-- BAGIAN 2 — 1.000 DETAIL untuk BL PALING ATAS ('BL 0001')
-- ============================================================================
-- Sengaja statement terpisah (bukan CTE data-modifying) supaya FK
-- bldetail.bl_id -> blheader.id dijamin melihat baris induk yang sudah
-- ter-commit.
BEGIN;

INSERT INTO bldetail (
  id, nobukti, bl_nobukti, bl_id, keterangan, noblconecting,
  shippinginstructiondetail_nobukti, info, modifiedby, created_at, updated_at
)
WITH ref AS (
  SELECT COALESCE(
           (SELECT memo::jsonb ->> 'KODE CABANG'
              FROM parameter WHERE grp = 'CABANG' AND subgrp = 'CABANG' LIMIT 1),
           '02'
         ) AS kode_cabang
),
-- BL tujuan = baris paling atas grid (default sort nobukti ASC). 'BL 0001' ada
-- di beberapa bulan (nomor di-reset tiap bulan), jadi diambil yang PALING BARU.
-- Ganti pola di WHERE kalau mau BL lain, mis. nobukti lengkap
-- 'BL 0002/VIII/2026'.
target AS (
  SELECT id, nobukti
  FROM blheader
  WHERE nobukti LIKE 'BL 0001/%'
  ORDER BY tglbukti DESC
  LIMIT 1
),
-- Kolom SI di grid detail (asalpelabuhan/consignee/shipper/comodity/
-- notifyparty/status pisah BL) berasal dari join ke shippinginstructiondetail,
-- jadi nobukti-nya harus yang benar-benar ada. Seluruhnya diputar bergantian.
sidetail AS (
  SELECT shippinginstructiondetail_nobukti AS nobukti,
         (row_number() OVER (ORDER BY shippinginstructiondetail_nobukti) - 1) AS rn,
         count(*) OVER ()                                                     AS n
  FROM shippinginstructiondetail
)
SELECT
  ref.kode_cabang || '-' || public.get_uuid_v7()::text,
  target.nobukti,
  'SEED BL ' || lpad(d::text, 4, '0'),
  target.id,
  'SEED DETAIL ' || lpad(d::text, 4, '0'),
  '',
  sd.nobukti,
  NULL,
  'seed',
  now(),
  now()
FROM generate_series(1, 1000) AS d
CROSS JOIN ref
CROSS JOIN target
LEFT JOIN sidetail sd ON sd.rn = (d - 1) % NULLIF(sd.n, 0);

COMMIT;

-- ============================================================================
-- BAGIAN 3 — 1.000 RINCIAN untuk DETAIL paling atas ('SEED BL 0001')
-- ============================================================================
BEGIN;

INSERT INTO bldetailrincian (
  id, nobukti, bldetail_id, bldetail_nobukti, orderanmuatan_nobukti,
  keterangan, info, modifiedby, created_at, updated_at
)
WITH ref AS (
  SELECT COALESCE(
           (SELECT memo::jsonb ->> 'KODE CABANG'
              FROM parameter WHERE grp = 'CABANG' AND subgrp = 'CABANG' LIMIT 1),
           '02'
         ) AS kode_cabang
),
-- Detail tujuan = baris pertama hasil BAGIAN 2 pada BL yang sama.
target AS (
  SELECT b.id, b.nobukti, b.bl_nobukti
  FROM bldetail b
  JOIN blheader h ON b.bl_id = h.id
  WHERE h.nobukti LIKE 'BL 0001/%'
    AND b.bl_nobukti = 'SEED BL 0001'
  ORDER BY h.tglbukti DESC, b.id
  LIMIT 1
),
-- orderanmuatan_nobukti punya FK ke orderanmuatan(nobukti) — nilainya tidak
-- boleh dikarang. Seluruh nobukti orderan muatan yang ada diputar bergantian.
orderan AS (
  SELECT nobukti,
         (row_number() OVER (ORDER BY nobukti) - 1) AS rn,
         count(*) OVER ()                           AS n
  FROM orderanmuatan
)
SELECT
  ref.kode_cabang || '-' || public.get_uuid_v7()::text,
  target.nobukti,
  target.id,
  target.bl_nobukti,
  o.nobukti,
  'SEED RINCIAN ' || lpad(r::text, 4, '0'),
  NULL,
  'seed',
  now(),
  now()
FROM generate_series(1, 1000) AS r
CROSS JOIN ref
CROSS JOIN target
-- INNER JOIN: kalau tabel orderanmuatan kosong, lebih baik 0 baris tersisip
-- daripada melanggar FK.
JOIN orderan o ON o.rn = (r - 1) % NULLIF(o.n, 0);

COMMIT;

/*
  ============================================================================
  MENGHAPUS SELURUH DATA SEED
  ============================================================================
  Urutannya dari anak ke induk supaya tidak melanggar FK.

  BEGIN;
  DELETE FROM bldetailrincianbiaya WHERE modifiedby = 'seed';
  DELETE FROM bldetailrincian      WHERE modifiedby = 'seed';
  DELETE FROM bldetail             WHERE modifiedby = 'seed';
  DELETE FROM blheader             WHERE modifiedby = 'seed';
  COMMIT;
*/
