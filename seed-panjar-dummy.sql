/*
  ============================================================================
  SEED DATA DUMMY PANJAR — untuk menguji lazy loading / windowed paging
  ============================================================================
  Target DB : Postgres (schema public)
  Jalankan  : psql -d <db> -f seed-panjar-dummy.sql

  Isi:
    BAGIAN 1 — 1.000 baris panjarheader, tglbukti tersebar di BULAN BERJALAN
               (dihitung dari CURRENT_DATE, jadi tidak perlu diedit tiap ganti
               bulan).
    BAGIAN 2 — 1.000 baris panjarmuatandetail untuk panjar 'EPM 0001'.

  Catatan penting:
    - `id` memakai '<kode cabang>-' || public.get_uuid_v7(). Fungsi itu VOLATILE
      sehingga dievaluasi per baris. Kalau dipakai fungsi STABLE/IMMUTABLE,
      Postgres boleh mengevaluasi sekali saja dan seluruh baris akan bertabrakan
      di PRIMARY KEY.
    - Format nobukti mengikuti parameter NOMOR PANJAR BIAYA yang aktif:
      `#EPM #9999#/#R#/#Y` -> 'EPM 0001/VIII/2026'. Nomor urut seed dimulai
      SETELAH nomor terbesar yang sudah ada di bulan yang sama, jadi script ini
      aman dijalankan berulang tanpa menghasilkan nobukti kembar.
    - panjarheader.nobukti TIDAK punya unique index, tapi RunningNumberService
      menghitung nomor berikutnya dari nobukti terbesar di bulan berjalan —
      setelah seed ini jalan, panjar baru akan lanjut dari nomor seed terakhir.
      Itu memang perilaku yang diharapkan (tidak menimpa data nyata).
    - FK yang aktif: panjarheader.{jenisorder_id,biayaemkl_id,statusformat} dan
      panjarmuatandetail.{panjar_id,orderanmuatan_nobukti}. Karena itu nilai
      referensi TIDAK di-hardcode — semuanya diambil dari baris master yang
      benar-benar ada lewat CTE `ref` / join ke tabel master.
    - orderanmuatan_nobukti WAJIB nobukti yang benar-benar ada di tabel
      `orderanmuatan` (FK). Detail seed memutar (cycle) seluruh nobukti orderan
      muatan yang tersedia. Kalau tabel `orderanmuatan` kosong, BAGIAN 2 tidak
      menyisipkan apa pun — bukan error FK.
    - Grid panjar membaca lewat view vpanjarheader yang menyaring GUC
      tas.panjar_tgldari / tglsampai / tas.panjar_jenisorder_id. Supaya data ini
      kelihatan di layar: pilih PERIODE = bulan berjalan dan JENIS ORDERAN =
      MUATAN.
    - Semua baris seed ditandai `modifiedby = 'seed'` (bukan lewat nobukti,
      supaya format nobukti tetap realistis). Itu penanda untuk menghapusnya
      lagi — lihat blok paling bawah.

  Ganti skala: ubah angka di `generate_series(1, 1000)` di BAGIAN 1 dan
  BAGIAN 2.
*/

-- ============================================================================
-- BAGIAN 1 — 1.000 HEADER, TGLBUKTI = BULAN BERJALAN
-- ============================================================================
BEGIN;

INSERT INTO panjarheader (
  id, nobukti, tglbukti, jenisorder_id, biayaemkl_id, keterangan,
  statusformat, info, modifiedby, created_at, updated_at
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
    -- Grid panjar selalu dipersempit ke satu jenis orderan, defaultnya MUATAN.
    -- Dicari by nama karena id-nya (uuid v7) berbeda per database.
    (SELECT id FROM jenisorder WHERE nama = 'MUATAN' LIMIT 1)  AS jenisorder_id,
    (SELECT id FROM parameter
       WHERE grp = 'NOMOR PANJAR BIAYA' AND kelompok = 'PANJAR BIAYA'
       LIMIT 1)                                                AS statusformat
),
-- Nomor urut terbesar yang sudah dipakai di bulan yang sama. Seed lanjut dari
-- sini supaya bisa dijalankan berulang tanpa nobukti kembar.
nomor_awal AS (
  SELECT COALESCE(
           max((regexp_match(h.nobukti, '^EPM ([0-9]+)/'))[1]::int),
           0
         ) AS last_no
  FROM panjarheader h
  CROSS JOIN ref r
  WHERE h.nobukti LIKE 'EPM %/' || r.bulan_romawi || '/' || r.tahun
),
-- Biaya EMKL diputar bergantian supaya kolom BIAYA EMKL di grid tidak seragam.
biaya AS (
  SELECT id, (row_number() OVER (ORDER BY nama) - 1) AS rn, count(*) OVER () AS n
  FROM biayaemkl
)
SELECT
  ref.kode_cabang || '-' || public.get_uuid_v7()::text,
  'EPM ' || lpad((nomor_awal.last_no + g)::text, 4, '0')
         || '/' || ref.bulan_romawi
         || '/' || ref.tahun,
  -- Sebar merata ke seluruh hari di bulan berjalan.
  ref.awal_bulan + ((g - 1) % ref.jml_hari),
  ref.jenisorder_id,
  b.id,
  'SEED PANJAR ' || g,
  ref.statusformat,
  NULL,
  'seed',
  now(),
  now()
FROM generate_series(1, 1000) AS g
CROSS JOIN ref
CROSS JOIN nomor_awal
-- LEFT JOIN: kalau tabel biayaemkl kosong, biayaemkl_id cukup NULL (nullable),
-- bukan menggagalkan seluruh insert.
LEFT JOIN biaya b ON b.rn = (g - 1) % NULLIF(b.n, 0);

COMMIT;

-- ============================================================================
-- BAGIAN 2 — 1.000 DETAIL untuk panjar 'EPM 0001'
-- ============================================================================
-- Sengaja statement terpisah (bukan CTE data-modifying) supaya FK
-- panjarmuatandetail.panjar_id -> panjarheader.id dijamin melihat baris induk
-- yang sudah ter-commit.
BEGIN;

INSERT INTO panjarmuatandetail (
  id, panjar_id, nobukti, orderanmuatan_nobukti, estimasi, nominal,
  keterangan, info, modifiedby, created_at, updated_at
)
WITH ref AS (
  SELECT COALESCE(
           (SELECT memo::jsonb ->> 'KODE CABANG'
              FROM parameter WHERE grp = 'CABANG' AND subgrp = 'CABANG' LIMIT 1),
           '02'
         ) AS kode_cabang
),
-- Panjar tujuan. 'EPM 0001' ada di beberapa bulan (nomor di-reset tiap bulan),
-- jadi diambil yang PALING BARU. Ganti pola di WHERE kalau mau panjar lain,
-- mis. 'EPM 0002/%' atau nobukti lengkap 'EPM 0001/VIII/2026'.
target AS (
  SELECT id, nobukti
  FROM panjarheader
  WHERE nobukti LIKE 'EPM 0001/%'
  ORDER BY tglbukti DESC
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
  target.id,
  target.nobukti,
  o.nobukti,
  ((d % 500) + 1) * 1000,                          -- estimasi bervariasi
  ((d % 500) + 1) * 1000 - ((d % 9) * 500),        -- nominal (realisasi) <= estimasi
  'SEED DETAIL ' || lpad(d::text, 4, '0'),
  NULL,
  'seed',
  now(),
  now()
FROM generate_series(1, 1000) AS d
CROSS JOIN ref
CROSS JOIN target
-- INNER JOIN: kalau tabel orderanmuatan kosong, lebih baik 0 baris tersisip
-- daripada melanggar FK.
JOIN orderan o ON o.rn = (d - 1) % NULLIF(o.n, 0);

COMMIT;

-- Statistik planner perlu di-refresh, kalau tidak query paginasi pertama bisa
-- memilih rencana buruk karena masih memakai estimasi jumlah baris yang lama.
ANALYZE panjarheader;
ANALYZE panjarmuatandetail;

-- ============================================================================
-- CEK HASIL
-- ============================================================================
SELECT 'header seed' AS info, count(*)::text AS jml
FROM panjarheader WHERE modifiedby = 'seed'
UNION ALL
SELECT 'detail seed', count(*)::text
FROM panjarmuatandetail WHERE modifiedby = 'seed'
UNION ALL
SELECT 'detail di EPM 0001 (total)', count(*)::text
FROM panjarmuatandetail d
WHERE d.panjar_id = (
  SELECT id FROM panjarheader
  WHERE nobukti LIKE 'EPM 0001/%' ORDER BY tglbukti DESC LIMIT 1
);

/*
  ============================================================================
  HAPUS SEMUA DATA SEED (kalau sudah selesai menguji)
  ============================================================================
  Detail dihapus DULUAN. panjarmuatandetail punya DUA constraint FK ke
  panjarheader: satu ON DELETE CASCADE dan satu lagi tanpa aksi (NO ACTION),
  jadi menghapus header lebih dulu bisa kena constraint yang NO ACTION itu.

  Baris detail seed di 'EPM 0001' ikut terhapus karena penandanya sama
  (modifiedby = 'seed'); detail asli milik panjar itu TIDAK tersentuh karena
  modifiedby-nya 'admin'.

  DELETE FROM panjarmuatandetail WHERE modifiedby = 'seed';
  DELETE FROM panjarheader       WHERE modifiedby = 'seed';
  ANALYZE panjarheader;
  ANALYZE panjarmuatandetail;
*/
