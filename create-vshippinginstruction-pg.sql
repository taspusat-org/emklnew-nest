/*
  View shipping instruction: header, detail, rincian (Postgres).

  Konteks: ketiga findAll() sebelumnya query langsung ke tabel base lalu
  LEFT JOIN 4-5 tabel referensi DI SETIAP REQUEST. Grid detail/rincian di-refetch
  tiap kali baris master berganti, jadi JOIN itu dibayar berulang. Polanya
  sekarang: tabel base untuk TULIS, VIEW untuk BACA.

  Gaya penulisan mengikuti vprospek (SQL Server) — lookup dikelompokkan ke CTE,
  bukan ditumpuk sebagai LEFT JOIN panjang di satu SELECT. TANPA index tambahan.

  --------------------------------------------------------------------------
  CATATAN PENYESUAIAN DARI SQL SERVER KE POSTGRES
  --------------------------------------------------------------------------
  1. WITH (READUNCOMMITTED) DIHAPUS — tidak ada padanannya dan tidak diperlukan.
     Postgres memakai MVCC: pembaca tidak pernah memblokir penulis dan sebaliknya,
     jadi tidak ada lock yang perlu dihindari. READ UNCOMMITTED pun kalau ditulis
     akan diperlakukan sebagai READ COMMITTED (dirty read tidak ada di Postgres).

  2. SESSION_CONTEXT() -> current_setting('tas.*', true).
     Service memanggil set_config('tas.*', nilai, true) sebelum query; is_local
     = true berarti otomatis hilang saat transaksi selesai, jadi tidak bocor ke
     request lain lewat connection pool. Pola ini sudah dipakai
     create-vpengeluaranheader-pg.sql, jadi konsisten dengan yang sudah ada.
     NULLIF(...,'') memperlakukan kosong sebagai "tanpa filter".

  3. BUTUH POSTGRES 12+. Beda penting dengan SQL Server: sampai PG11, CTE selalu
     di-materialize (jadi optimization fence) sehingga justru bisa LEBIH LAMBAT
     dari LEFT JOIN biasa. Sejak PG12 CTE non-rekursif yang dipakai sekali
     di-inline otomatis, jadi rencana eksekusinya setara. Kalau server masih PG11
     ke bawah, tambahkan hint MATERIALIZED/NOT MATERIALIZED atau kembalikan ke
     bentuk LEFT JOIN datar.

  Jalankan sekali:
    psql -d <db> -f create-vshippinginstruction-pg.sql

  Catatan re-run: CREATE OR REPLACE VIEW di Postgres hanya boleh MENAMBAH kolom
  di akhir. Kalau ada kolom yang di-rename/dihapus lalu script ini dijalankan
  ulang, Postgres menolak dengan "cannot change name of view column". Kalau itu
  terjadi, DROP dulu lalu jalankan lagi:
    DROP VIEW IF EXISTS public.vshippinginstructiondetailrincian;
    DROP VIEW IF EXISTS public.vshippinginstructiondetail;
    DROP VIEW IF EXISTS public.vshippinginstructionheader;
*/

-- ============================================================
-- 1. HEADER
--    Difilter rentang tanggal lewat session context supaya penyaringan terjadi
--    di dalam view, sebelum digabung dengan data jadwal.
-- ============================================================
CREATE OR REPLACE VIEW public.vshippinginstructionheader AS
WITH tempheader AS (
  SELECT
    u.id,
    u.nobukti,
    u.tglbukti,
    u.schedule_id,
    u.statusformat,
    u.modifiedby,
    u.created_at,
    u.updated_at
  FROM shippinginstructionheader u
  WHERE (
    NULLIF(current_setting('tas.si_tgldari', true), '') IS NULL
    OR NULLIF(current_setting('tas.si_tglsampai', true), '') IS NULL
    -- NULLIF(...,'')::date, BUKAN CAST(... AS date): nilainya bisa '' saat filter
    -- tanggal tidak aktif. OR di SQL tidak dijamin short-circuit, jadi cast tetap
    -- dievaluasi walau guard IS NULL true — CAST('' AS date) melempar error.
    OR u.tglbukti BETWEEN NULLIF(current_setting('tas.si_tgldari', true), '')::date
                      AND NULLIF(current_setting('tas.si_tglsampai', true), '')::date
  )
),
tempjadwal AS (
  SELECT
    p.id,
    p.voyberangkat,
    p.tglberangkat,
    p.pelayaran_id,
    p.kapal_id,
    p.tujuankapal_id,
    pel.nama AS pelayaran_nama,
    kpl.nama AS kapal_nama,
    tjk.nama AS tujuankapal_nama
  FROM schedulekapal p
  LEFT JOIN pelayaran   pel ON p.pelayaran_id   = pel.id
  LEFT JOIN kapal       kpl ON p.kapal_id       = kpl.id
  LEFT JOIN tujuankapal tjk ON p.tujuankapal_id = tjk.id
)
SELECT
  u.id,
  u.nobukti,
  u.tglbukti,
  u.schedule_id,
  u.statusformat,
  u.modifiedby,
  u.created_at,
  u.updated_at,
  j.voyberangkat,
  j.tglberangkat,
  j.pelayaran_id,
  j.kapal_id,
  j.tujuankapal_id,
  j.pelayaran_nama,
  j.kapal_nama,
  j.tujuankapal_nama
FROM tempheader u
LEFT JOIN tempjadwal j ON u.schedule_id = j.id;

-- ============================================================
-- 2. DETAIL
--    TANPA filter session context. shippinginstruction_id tetap dikirim service
--    sebagai WHERE eksplisit — lihat catatan di bawah file ini.
-- ============================================================
CREATE OR REPLACE VIEW public.vshippinginstructiondetail AS
WITH tempstatus AS (
  SELECT id, text, memo
  FROM parameter
),
tempemkl AS (
  SELECT id, nama
  FROM emkl
),
temppelayaran AS (
  SELECT id, nama
  FROM pelayaran
),
temptujuankapal AS (
  SELECT id, nama
  FROM tujuankapal
),
tempdaftarbl AS (
  SELECT id, nama
  FROM daftarbl
)
SELECT
  p.id,
  p.shippinginstruction_id,
  p.nobukti,
  p.tglbukti,
  p.shippinginstructiondetail_nobukti,
  p.asalpelabuhan,
  p.keterangan,
  p.consignee,
  p.shipper,
  p.comodity,
  p.notifyparty,
  p.totalgw,
  p.statuspisahbl,
  p.emkl_id,
  p.containerpelayaran_id,
  p.tujuankapal_id,
  p.daftarbl_id,
  p.statusformat,
  p.modifiedby,
  p.created_at,
  p.updated_at,
  par.text AS statuspisahbl_nama,
  par.memo AS statuspisahbl_memo,
  emk.nama AS emkllain_nama,
  pel.nama AS containerpelayaran_nama,
  tjk.nama AS tujuankapal_nama,
  bl.nama  AS daftarbl_nama
FROM shippinginstructiondetail p
LEFT JOIN tempstatus      par ON p.statuspisahbl         = par.id
LEFT JOIN tempemkl        emk ON p.emkl_id               = emk.id
LEFT JOIN temppelayaran   pel ON p.containerpelayaran_id = pel.id
LEFT JOIN temptujuankapal tjk ON p.tujuankapal_id        = tjk.id
LEFT JOIN tempdaftarbl    bl  ON p.daftarbl_id           = bl.id;

-- ============================================================
-- 3. RINCIAN
--    TANPA filter session context, alasan sama dengan detail.
-- ============================================================
CREATE OR REPLACE VIEW public.vshippinginstructiondetailrincian AS
WITH temporderan AS (
  SELECT nobukti, shipper_id, nocontainer, noseal
  FROM orderanmuatan
),
tempshipper AS (
  SELECT id, nama
  FROM shipper
)
SELECT
  p.id,
  p.nobukti,
  p.shippinginstructiondetail_id,
  p.shippinginstructiondetail_nobukti,
  p.orderanmuatan_nobukti,
  p.comodity,
  p.keterangan,
  p.modifiedby,
  p.created_at,
  p.updated_at,
  q.shipper_id,
  q.nocontainer,
  q.noseal,
  r.nama AS shipper_nama
FROM shippinginstructiondetailrincian p
LEFT JOIN temporderan q ON p.orderanmuatan_nobukti = q.nobukti
LEFT JOIN tempshipper r ON q.shipper_id            = r.id;

/*
  Kenapa detail & rincian TIDAK ikut memakai session context:

  Untuk header, filter tanggal cuma mempersempit daftar — kalau GUC lupa di-set,
  paling buruk grid menampilkan semua periode. Tidak merusak data.

  Untuk detail & rincian beda: shippinginstruction_id / shippinginstructiondetail_id
  bukan sekadar filter tampilan. FormShippingInstruction memakai hasil endpoint
  ini sebagai payload simpan, dan create() MENGHAPUS baris yang tidak ada di
  payload. Kalau GUC lupa di-set, view memulangkan SELURUH detail milik semua
  shipping instruction — dan itu ikut terkirim saat simpan. Predikat sepenting
  itu dibiarkan eksplisit di service supaya tidak bisa hilang diam-diam.
*/
