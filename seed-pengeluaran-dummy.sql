/*
  ============================================================================
  SEED DATA DUMMY PENGELUARAN — untuk menguji lazy loading / windowed paging
  ============================================================================
  Target DB : Postgres (tasemkl)
  Jalankan  : psql -d tasemkl -f seed-pengeluaran-dummy.sql

  Isi:
    BAGIAN 1 — 100.000 baris pengeluaranheader, tglbukti tersebar di BULAN
               BERJALAN (dihitung dari CURRENT_DATE, jadi tidak perlu diedit
               tiap ganti bulan).
    BAGIAN 2 — 5 baris pengeluaranheader, masing-masing 50.000 baris
               pengeluarandetail (total 250.000 detail).

  Catatan penting:
    - `id` memakai '<kode cabang>-' || public.get_uuid_v7(). Fungsi itu VOLATILE
      sehingga dievaluasi per baris (sudah diverifikasi: 5 baris -> 5 uuid beda).
      Kalau dipakai fungsi STABLE/IMMUTABLE, Postgres boleh mengevaluasi sekali
      saja dan seluruh baris akan bertabrakan di PRIMARY KEY.
    - `pengeluaranheader.nobukti` punya UNIQUE INDEX
      (idx_33353_uq_pengeluaranheader_nobukti), jadi nomor urut di-lpad supaya
      dijamin unik. Semua data seed diberi awalan 'SEED-' agar gampang dihapus.
    - FK yang aktif: pengeluaranheader.{relasi_id,bank_id,coakredit,
      daftarbank_id,statusformat} dan pengeluarandetail.{coadebet,pengeluaran_id}.
      Karena itu nilai referensi TIDAK di-hardcode — semuanya diambil dari baris
      master yang benar-benar ada lewat CTE `ref`.
    - Grid pengeluaran memfilter lewat view vpengeluaranheader yang membaca GUC
      tas.tgldari/tglsampai/tas.bank_id. Supaya data ini kelihatan di layar,
      pilih PERIODE = bulan berjalan dan BANK = bank yang dipakai di bawah.

  Ganti skala: ubah angka di `generate_series(1, 100000)` (BAGIAN 1) dan
  `generate_series(1, 50000)` (BAGIAN 2b).
*/

-- ============================================================================
-- BAGIAN 1 — 100.000 HEADER, TGLBUKTI = BULAN BERJALAN
-- ============================================================================
BEGIN;

INSERT INTO pengeluaranheader (
  id, nobukti, tglbukti, relasi_id, keterangan, bank_id, postingdari,
  coakredit, dibayarke, alatbayar_id, nowarkat, tgljatuhtempo,
  pengeluaranemklgantung_nobukti, penerimaanemklgantung_nobukti,
  daftarbank_id, statusformat, info, modifiedby, created_at, updated_at
)
SELECT
  ref.kode_cabang || '-' || public.get_uuid_v7()::text,
  'SEED-H ' || lpad(g::text, 6, '0') || '/' || to_char(CURRENT_DATE, 'MM-YYYY'),
  -- Sebar merata ke seluruh hari di bulan berjalan.
  ref.awal_bulan + ((g - 1) % ref.jml_hari),
  ref.relasi_id,
  'SEED HEADER ' || g,
  ref.bank_id,
  'PENGELUARAN SEED',
  ref.coakredit,
  'SEED DIBAYARKE ' || g,
  ref.alatbayar_id,
  '',
  ref.awal_bulan + ((g - 1) % ref.jml_hari),
  '',
  '',
  ref.daftarbank_id,
  ref.statusformat,
  NULL,
  'seed',
  now(),
  now()
FROM generate_series(1, 100000) AS g
CROSS JOIN (
  SELECT
    COALESCE(
      (SELECT memo::jsonb ->> 'KODE CABANG'
         FROM parameter WHERE grp = 'CABANG' AND subgrp = 'CABANG' LIMIT 1),
      '02'
    )                                                                AS kode_cabang,
    date_trunc('month', CURRENT_DATE)::date                          AS awal_bulan,
    EXTRACT(
      day FROM (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')
    )::int                                                           AS jml_hari,
    -- Ganti 'BRI' kalau mau bank lain. Fallback ke bank mana pun yang ada.
    COALESCE(
      (SELECT id FROM bank WHERE nama = 'BRI' LIMIT 1),
      (SELECT id FROM bank ORDER BY id LIMIT 1)
    )                                                                AS bank_id,
    (SELECT id  FROM relasi     ORDER BY id  LIMIT 1)                AS relasi_id,
    (SELECT coa FROM akunpusat  ORDER BY coa LIMIT 1)                AS coakredit,
    (SELECT id  FROM alatbayar  ORDER BY id  LIMIT 1)                AS alatbayar_id,
    (SELECT id  FROM daftarbank ORDER BY id  LIMIT 1)                AS daftarbank_id,
    (SELECT statusformat FROM pengeluaranheader
       WHERE statusformat IS NOT NULL LIMIT 1)                       AS statusformat
) AS ref;

COMMIT;

-- ============================================================================
-- BAGIAN 2a — 5 HEADER penampung detail
-- ============================================================================
BEGIN;

INSERT INTO pengeluaranheader (
  id, nobukti, tglbukti, relasi_id, keterangan, bank_id, postingdari,
  coakredit, dibayarke, alatbayar_id, nowarkat, tgljatuhtempo,
  pengeluaranemklgantung_nobukti, penerimaanemklgantung_nobukti,
  daftarbank_id, statusformat, info, modifiedby, created_at, updated_at
)
SELECT
  ref.kode_cabang || '-' || public.get_uuid_v7()::text,
  'SEED-BIG ' || lpad(g::text, 2, '0') || '/' || to_char(CURRENT_DATE, 'MM-YYYY'),
  ref.awal_bulan,
  ref.relasi_id,
  'SEED HEADER BESAR ' || g || ' (50.000 detail)',
  ref.bank_id,
  'PENGELUARAN SEED',
  ref.coakredit,
  'SEED DIBAYARKE ' || g,
  ref.alatbayar_id,
  '',
  ref.awal_bulan,
  '',
  '',
  ref.daftarbank_id,
  ref.statusformat,
  NULL,
  'seed',
  now(),
  now()
FROM generate_series(1, 5) AS g
CROSS JOIN (
  SELECT
    COALESCE(
      (SELECT memo::jsonb ->> 'KODE CABANG'
         FROM parameter WHERE grp = 'CABANG' AND subgrp = 'CABANG' LIMIT 1),
      '02'
    )                                                                AS kode_cabang,
    date_trunc('month', CURRENT_DATE)::date                          AS awal_bulan,
    COALESCE(
      (SELECT id FROM bank WHERE nama = 'BRI' LIMIT 1),
      (SELECT id FROM bank ORDER BY id LIMIT 1)
    )                                                                AS bank_id,
    (SELECT id  FROM relasi     ORDER BY id  LIMIT 1)                AS relasi_id,
    (SELECT coa FROM akunpusat  ORDER BY coa LIMIT 1)                AS coakredit,
    (SELECT id  FROM alatbayar  ORDER BY id  LIMIT 1)                AS alatbayar_id,
    (SELECT id  FROM daftarbank ORDER BY id  LIMIT 1)                AS daftarbank_id,
    (SELECT statusformat FROM pengeluaranheader
       WHERE statusformat IS NOT NULL LIMIT 1)                       AS statusformat
) AS ref;

-- ============================================================================
-- BAGIAN 2b — 50.000 DETAIL untuk tiap header 'SEED-BIG %'
-- ============================================================================
-- Sengaja statement terpisah (bukan CTE data-modifying) supaya FK
-- pengeluarandetail.pengeluaran_id -> pengeluaranheader.id dijamin sudah punya
-- baris induk saat detail di-insert.
INSERT INTO pengeluarandetail (
  id, pengeluaran_id, coadebet, nobukti, keterangan, nominal, dpp,
  transaksibiaya_nobukti, transaksilain_nobukti, noinvoiceemkl, tglinvoiceemkl,
  nofakturpajakemkl, perioderefund, pengeluaranemklheader_nobukti,
  penerimaanemklheader_nobukti, kasgantung_nobukti, info, modifiedby,
  created_at, updated_at
)
SELECT
  ref.kode_cabang || '-' || public.get_uuid_v7()::text,
  h.id,
  ref.coadebet,
  h.nobukti,
  'SEED DETAIL ' || lpad(d::text, 5, '0'),
  (d % 1000 + 1) * 1000,          -- nominal bervariasi
  (d % 100) * 100,                -- dpp bervariasi
  '', '',
  'INV-' || lpad(d::text, 6, '0'),
  CURRENT_DATE - (d % 28),
  'FP-' || lpad(d::text, 6, '0'),
  to_char(CURRENT_DATE, 'MM-YYYY'),
  '', '', '',
  NULL,
  'seed',
  now(),
  now()
FROM pengeluaranheader h
CROSS JOIN generate_series(1, 50000) AS d
CROSS JOIN (
  SELECT
    COALESCE(
      (SELECT memo::jsonb ->> 'KODE CABANG'
         FROM parameter WHERE grp = 'CABANG' AND subgrp = 'CABANG' LIMIT 1),
      '02'
    )                                                 AS kode_cabang,
    (SELECT coa FROM akunpusat ORDER BY coa LIMIT 1)  AS coadebet
) AS ref
WHERE h.nobukti LIKE 'SEED-BIG %';

COMMIT;

-- Statistik planner perlu di-refresh, kalau tidak query paginasi pertama bisa
-- memilih rencana buruk karena masih memakai estimasi jumlah baris yang lama.
ANALYZE pengeluaranheader;
ANALYZE pengeluarandetail;

-- Cek hasil
SELECT 'header bulan ini' AS info, count(*) AS jml
FROM pengeluaranheader
WHERE nobukti LIKE 'SEED-H %'
UNION ALL
SELECT 'header besar', count(*) FROM pengeluaranheader WHERE nobukti LIKE 'SEED-BIG %'
UNION ALL
SELECT 'detail seed', count(*) FROM pengeluarandetail WHERE nobukti LIKE 'SEED-BIG %';

/*
  ============================================================================
  HAPUS SEMUA DATA SEED (kalau sudah selesai menguji)
  ============================================================================
  Detail dihapus DULUAN. Tabel pengeluarandetail punya DUA constraint FK ke
  pengeluaranheader: satu ON DELETE CASCADE dan satu lagi tanpa aksi (NO
  ACTION). Menghapus header lebih dulu bisa kena constraint yang NO ACTION itu.

  DELETE FROM pengeluarandetail  WHERE nobukti LIKE 'SEED-%';
  DELETE FROM pengeluaranheader  WHERE nobukti LIKE 'SEED-%';
  ANALYZE pengeluaranheader;
  ANALYZE pengeluarandetail;
*/
