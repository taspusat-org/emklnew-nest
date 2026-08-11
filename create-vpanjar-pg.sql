/*
  View panjar: header + muatan detail (Postgres).

  Konteks: PanjarheaderService.findAll() sebelumnya query langsung ke tabel base
  `panjarheader` + LEFT JOIN `jenisorder` dan `biayaemkl` DI SETIAP REQUEST, dan
  PanjarmuatandetailService.findAll() query langsung ke tabel base tanpa
  pagination. Grid header memakai windowed pagination (menarik 5 halaman
  sekaligus lalu menggeser window saat scroll), jadi JOIN itu dibayar berulang.
  Polanya sekarang disamakan dengan alatbayar / pengeluaran / shipping
  instruction: tabel base untuk TULIS, VIEW untuk BACA.

  Gaya penulisan mengikuti create-vshippinginstruction-pg.sql — lookup
  dikelompokkan ke CTE, bukan ditumpuk sebagai LEFT JOIN panjang.

  --------------------------------------------------------------------------
  CATATAN PENYESUAIAN DARI SQL SERVER KE POSTGRES
  --------------------------------------------------------------------------
  1. SESSION_CONTEXT() -> current_setting('tas.*', true).
     Service memanggil set_config('tas.*', nilai, true) sebelum query; is_local
     = true berarti otomatis hilang saat transaksi selesai sehingga tidak bocor
     ke request lain lewat connection pool. NULLIF(...,'') memperlakukan kosong
     sebagai "tanpa filter". Pola yang sama sudah dipakai vpengeluaranheader dan
     vshippinginstructionheader.

  2. WITH (READUNCOMMITTED) DIHAPUS — Postgres memakai MVCC, pembaca tidak
     pernah memblokir penulis, jadi tidak ada lock yang perlu dihindari.

  3. BUTUH POSTGRES 12+ supaya CTE non-rekursif yang dipakai sekali di-inline
     otomatis (bukan optimization fence seperti PG11 ke bawah).

  Jalankan sekali:
    psql -d <db> -f create-vpanjar-pg.sql

  Catatan re-run: CREATE OR REPLACE VIEW di Postgres hanya boleh MENAMBAH kolom
  di akhir. Kalau ada kolom yang di-rename/dihapus lalu script ini dijalankan
  ulang, Postgres menolak dengan "cannot change name of view column". Kalau itu
  terjadi, DROP dulu lalu jalankan lagi:
    DROP VIEW IF EXISTS public.vpanjarmuatandetail;
    DROP VIEW IF EXISTS public.vpanjarheader;
*/

-- ============================================================
-- 1. HEADER
--    Dua filter "wajib" grid ikut masuk ke dalam view lewat session context:
--      - rentang tanggal (tas.panjar_tgldari / tas.panjar_tglsampai)
--      - jenis orderan  (tas.panjar_jenisorder_id)
--    Keduanya sudah jadi predikat WHERE di service versi lama, dipindah ke sini
--    supaya penyaringan terjadi SEBELUM join lookup dan supaya query COUNT,
--    query data, dan perhitungan posisi baris pasti melihat dataset yang sama.
-- ============================================================
CREATE OR REPLACE VIEW public.vpanjarheader AS
WITH tempjenisorder AS (
  SELECT id, nama
  FROM jenisorder
),
tempbiayaemkl AS (
  SELECT id, nama
  FROM biayaemkl
)
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
  j.nama AS jenisorder_nama,
  b.nama AS biayaemkl_nama
FROM panjarheader u
LEFT JOIN tempjenisorder j ON u.jenisorder_id = j.id
LEFT JOIN tempbiayaemkl  b ON u.biayaemkl_id  = b.id
WHERE (
  NULLIF(current_setting('tas.panjar_tgldari', true), '') IS NULL
  OR NULLIF(current_setting('tas.panjar_tglsampai', true), '') IS NULL
  -- NULLIF(...,'')::date, BUKAN CAST(... AS date): nilainya bisa '' saat filter
  -- tanggal tidak aktif. OR di SQL tidak dijamin short-circuit, jadi cast tetap
  -- dievaluasi walau guard IS NULL true — CAST('' AS date) melempar error.
  OR u.tglbukti BETWEEN NULLIF(current_setting('tas.panjar_tgldari', true), '')::date
                    AND NULLIF(current_setting('tas.panjar_tglsampai', true), '')::date
)
AND (
  NULLIF(current_setting('tas.panjar_jenisorder_id', true), '') IS NULL
  -- jenisorder_id kini uuid v7 bertipe text (case-sensitive), jadi dibandingkan
  -- apa adanya — bukan di-uppercase seperti kode lama peninggalan MSSQL.
  OR u.jenisorder_id = current_setting('tas.panjar_jenisorder_id', true)
);

-- ============================================================
-- 2. MUATAN DETAIL
--    TANPA filter session context. Detail selalu dipersempit oleh panjar_id
--    dari header yang sedang dipilih, dan predikat itu sengaja dibiarkan
--    eksplisit di service — lihat catatan di bawah file ini.
-- ============================================================
CREATE OR REPLACE VIEW public.vpanjarmuatandetail AS
SELECT
  p.id,
  p.panjar_id,
  p.nobukti,
  p.orderanmuatan_nobukti,
  p.estimasi,
  p.nominal,
  p.keterangan,
  p.info,
  p.modifiedby,
  p.created_at,
  p.updated_at
FROM panjarmuatandetail p;

-- ============================================================
-- 3. INDEX PENDUKUNG
--    findAll header SELALU menyaring tglbukti + jenisorder_id lalu
--    mengurutkan + offset/limit; findAll detail SELALU menyaring panjar_id.
--    Tanpa index ini setiap pergeseran window men-scan seluruh tabel.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_panjarheader_tglbukti
  ON panjarheader (tglbukti);
CREATE INDEX IF NOT EXISTS idx_panjarheader_jenisorder_tglbukti
  ON panjarheader (jenisorder_id, tglbukti);
CREATE INDEX IF NOT EXISTS idx_panjarmuatandetail_panjar_id
  ON panjarmuatandetail (panjar_id);
CREATE INDEX IF NOT EXISTS idx_panjarmuatandetail_panjar_id_id
  ON panjarmuatandetail (panjar_id, id);

/*
  Kenapa detail TIDAK ikut memakai session context:

  Untuk header, filter tanggal/jenis orderan cuma mempersempit daftar — kalau
  GUC lupa di-set, paling buruk grid menampilkan semua periode. Tidak merusak
  data.

  Untuk detail beda: panjar_id bukan sekadar filter tampilan. FormPanjarHeader
  memakai hasil endpoint ini sebagai payload simpan, dan
  PanjarmuatandetailService.create() MENGHAPUS baris yang tidak ada di payload.
  Kalau GUC lupa di-set, view memulangkan SELURUH detail milik semua panjar —
  dan itu ikut terkirim saat simpan. Predikat sepenting itu dibiarkan eksplisit
  di service supaya tidak bisa hilang diam-diam.

  Kenapa view detail "hanya" proyeksi tabel base:

  Kolom grid detail memang semuanya kolom base. Viewnya tetap dibuat supaya
  jalur BACA panjar (header + detail) konsisten satu pintu seperti pengeluaran
  dan shipping instruction — kolom turunan (mis. teks lookup orderan) nanti
  cukup ditambahkan di sini tanpa menyentuh service atau menambah JOIN
  per-request di jalur windowed pagination.
*/
