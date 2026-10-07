-- =====================================================================
-- Index & primary key untuk jalur Penerimaan
--
-- Jalankan manual di pgAdmin pada database `tasemkl`, schema `public`.
-- Script ini idempotent: aman dijalankan ulang seluruhnya.
--
-- LATAR BELAKANG
-- 128 dari 130 file di `migrations/` memakai sintaks SQL Server
-- (`CREATE TABLE [dbo].[x]`, `nvarchar(MAX)`, `CONSTRAINT [PK_x] PRIMARY KEY`)
-- sehingga TIDAK PERNAH jalan di Postgres — skema/isi tabelnya masuk lewat
-- import data langsung. Akibatnya tabel-tabel ini tidak punya primary key
-- maupun index sama sekali. Persoalan yang sama sudah pernah didiagnosis dan
-- diperbaiki untuk satu tabel saja di
-- `migrations/20260711000001_add_alatbayar_indexes.ts` (di sana: 524ms -> 16ms).
--
-- DAMPAKNYA DI PENERIMAAN
-- 1. Tiap request grid = Seq Scan penerimaanheader + Hash Join SELURUH isi
--    relasi/bank/akunpusat/alatbayar, lalu Sort penuh untuk ORDER BY.
-- 2. Tanpa UNIQUE di kolom yang di-join, Postgres tidak boleh membuang LEFT
--    JOIN yang kolomnya tidak dipakai. Jadi query COUNT — yang cuma butuh
--    jumlah baris penerimaanheader — tetap membayar keempat join itu.
-- 3. Membuka grid memicu 1 bulk fetch (limit 250) + sampai 5 prefetch paralel;
--    masing-masing menjalankan COUNT + SELECT. 12 query berat sekaligus.
--
-- CATATAN URUTAN
-- Bagian 1 (index biasa) aman dijalankan kapan saja. Bagian 2 (UNIQUE) bisa
-- GAGAL kalau datanya sudah terlanjur punya duplikat — jalankan dulu query
-- pemeriksaan di Bagian 0 dan bersihkan duplikatnya sebelum melanjutkan.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Periksa dulu: adakah duplikat yang akan menggagalkan UNIQUE?
--    Jalankan SENDIRI, lihat hasilnya, baru lanjut ke bagian berikutnya.
--    Semua harus mengembalikan 0 baris.
-- ---------------------------------------------------------------------
-- SELECT id, COUNT(*) FROM penerimaanheader GROUP BY id HAVING COUNT(*) > 1;
-- SELECT id, COUNT(*) FROM penerimaandetail GROUP BY id HAVING COUNT(*) > 1;
-- SELECT id, COUNT(*) FROM relasi          GROUP BY id HAVING COUNT(*) > 1;
-- SELECT id, COUNT(*) FROM bank            GROUP BY id HAVING COUNT(*) > 1;
-- SELECT coa, COUNT(*) FROM akunpusat WHERE coa IS NOT NULL
--   GROUP BY coa HAVING COUNT(*) > 1;
--
-- Khusus akunpusat.coa: kalau ADA duplikat, itu bukan sekadar soal kecepatan.
-- vpenerimaanheader dan vpenerimaandetail meng-join lewat kolom ini, jadi satu
-- baris penerimaan akan MENGGANDA sebanyak duplikatnya — grid menampilkan baris
-- kembar dan COUNT-nya ikut salah. Perbaiki datanya lebih dulu.

-- ---------------------------------------------------------------------
-- 1. Index pendukung filter, sort, dan join
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_penerimaanheader_tglbukti
    ON public.penerimaanheader (tglbukti);
CREATE INDEX IF NOT EXISTS idx_penerimaanheader_bank_tglbukti
    ON public.penerimaanheader (bank_id, tglbukti);
CREATE INDEX IF NOT EXISTS idx_penerimaanheader_nobukti
    ON public.penerimaanheader (nobukti);
CREATE INDEX IF NOT EXISTS idx_penerimaanheader_relasi_id
    ON public.penerimaanheader (relasi_id);
CREATE INDEX IF NOT EXISTS idx_penerimaanheader_alatbayar_id
    ON public.penerimaanheader (alatbayar_id);
CREATE INDEX IF NOT EXISTS idx_penerimaanheader_coakasmasuk
    ON public.penerimaanheader (coakasmasuk);
CREATE INDEX IF NOT EXISTS idx_penerimaanheader_created_at
    ON public.penerimaanheader (created_at);
CREATE INDEX IF NOT EXISTS idx_penerimaanheader_updated_at
    ON public.penerimaanheader (updated_at);

CREATE INDEX IF NOT EXISTS idx_penerimaandetail_penerimaan_id
    ON public.penerimaandetail (penerimaan_id);
CREATE INDEX IF NOT EXISTS idx_penerimaandetail_nobukti
    ON public.penerimaandetail (nobukti);
CREATE INDEX IF NOT EXISTS idx_penerimaandetail_coa
    ON public.penerimaandetail (coa);
CREATE INDEX IF NOT EXISTS idx_penerimaandetail_pengembaliankasgantung
    ON public.penerimaandetail (pengembaliankasgantung_nobukti);
-- Urutan baris detail: ORDER BY created_at, id.
CREATE INDEX IF NOT EXISTS idx_penerimaandetail_nobukti_created_at
    ON public.penerimaandetail (nobukti, created_at);

-- Sisi master yang di-join view. Tanpa ini tiap join = scan tabel penuh.
CREATE INDEX IF NOT EXISTS idx_akunpusat_coa
    ON public.akunpusat (coa);

-- Dipakai update/delete penerimaan untuk menemukan jurnalnya.
CREATE INDEX IF NOT EXISTS idx_jurnalumumheader_nobukti
    ON public.jurnalumumheader (nobukti);

-- ---------------------------------------------------------------------
-- 2. UNIQUE pada kolom id — pengganti primary key yang tidak pernah terbentuk
--
-- Selain mempercepat lookup `where id = ...` (create/update/delete/findOne),
-- ini yang MEMBOLEHKAN Postgres membuang LEFT JOIN yang kolomnya tidak dipakai.
-- Efeknya paling terasa di query COUNT milik grid: dari 4 join menjadi tanpa
-- join sama sekali.
--
-- Jalankan hanya setelah Bagian 0 bersih.
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_penerimaanheader_id
    ON public.penerimaanheader (id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_penerimaandetail_id
    ON public.penerimaandetail (id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_relasi_id
    ON public.relasi (id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_id
    ON public.bank (id);

-- akunpusat.coa: hanya jadikan UNIQUE kalau Bagian 0 memang bersih. Kolom ini
-- yang di-join view, jadi UNIQUE di sini yang membuat join-nya bisa dibuang.
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_akunpusat_coa_unique
--     ON public.akunpusat (coa);

-- ---------------------------------------------------------------------
-- 3. Segarkan statistik supaya planner memakai index yang baru dibuat
-- ---------------------------------------------------------------------
ANALYZE public.penerimaanheader;
ANALYZE public.penerimaandetail;
ANALYZE public.relasi;
ANALYZE public.bank;
ANALYZE public.akunpusat;
ANALYZE public.jurnalumumheader;
