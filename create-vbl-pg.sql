/*
  View BL: header, detail, rincian (Postgres).

  Konteks: ketiga findAll() sebelumnya query langsung ke tabel base lalu
  LEFT JOIN 4-5 tabel referensi DI SETIAP REQUEST. Grid header memakai windowed
  pagination (menarik 5 halaman sekaligus lalu menggeser window saat scroll) dan
  grid detail/rincian di-refetch tiap kali baris master berganti, jadi JOIN itu
  dibayar berulang. Polanya sekarang disamakan dengan shipping instruction /
  panjar / pengeluaran: tabel base untuk TULIS, VIEW untuk BACA.

  Gaya penulisan mengikuti create-vshippinginstruction-pg.sql — lookup
  dikelompokkan ke CTE, bukan ditumpuk sebagai LEFT JOIN panjang di satu SELECT.

  --------------------------------------------------------------------------
  CATATAN PENYESUAIAN DARI SQL SERVER KE POSTGRES
  --------------------------------------------------------------------------
  1. SESSION_CONTEXT() -> current_setting('tas.*', true).
     Service memanggil set_config('tas.*', nilai, true) sebelum query; is_local
     = true berarti otomatis hilang saat transaksi selesai sehingga tidak bocor
     ke request lain lewat connection pool. NULLIF(...,'') memperlakukan kosong
     sebagai "tanpa filter". Pola yang sama sudah dipakai vshippinginstruction-
     header, vpengeluaranheader, dan vpanjarheader.

  2. WITH (READUNCOMMITTED) DIHAPUS — Postgres memakai MVCC, pembaca tidak
     pernah memblokir penulis, jadi tidak ada lock yang perlu dihindari.

  3. BUTUH POSTGRES 12+ supaya CTE non-rekursif yang dipakai sekali di-inline
     otomatis (bukan optimization fence seperti PG11 ke bawah).

  Jalankan sekali:
    psql -d <db> -f create-vbl-pg.sql

  Catatan re-run: CREATE OR REPLACE VIEW di Postgres hanya boleh MENAMBAH kolom
  di akhir. Kalau ada kolom yang di-rename/dihapus lalu script ini dijalankan
  ulang, Postgres menolak dengan "cannot change name of view column". Kalau itu
  terjadi, DROP dulu lalu jalankan lagi:
    DROP VIEW IF EXISTS public.vbldetailrincian;
    DROP VIEW IF EXISTS public.vbldetail;
    DROP VIEW IF EXISTS public.vblheader;
*/

-- ============================================================
-- 1. HEADER
--    Difilter rentang tanggal lewat session context supaya penyaringan terjadi
--    di dalam view, SEBELUM digabung dengan data jadwal — dan supaya query
--    COUNT, query data, dan perhitungan posisi baris pasti melihat dataset yang
--    sama.
--
--    CATATAN tglberangkat: blheader punya kolom tglberangkat SENDIRI, terpisah
--    dari schedulekapal.tglberangkat. Yang dipakai grid adalah milik blheader
--    (itu yang di-select findAll versi lama), jadi kolom jadwal sengaja TIDAK
--    ikut diekspos supaya tidak ada dua kolom bernama sama yang tertukar.
-- ============================================================
CREATE OR REPLACE VIEW public.vblheader AS
WITH tempheader AS (
  SELECT
    u.id,
    u.nobukti,
    u.tglbukti,
    u.schedule_id,
    u.statusformat,
    u.tglberangkat,
    u.shippinginstruction_nobukti,
    u.info,
    u.modifiedby,
    u.created_at,
    u.updated_at
  FROM blheader u
  WHERE (
    NULLIF(current_setting('tas.bl_tgldari', true), '') IS NULL
    OR NULLIF(current_setting('tas.bl_tglsampai', true), '') IS NULL
    -- NULLIF(...,'')::date, BUKAN CAST(... AS date): nilainya bisa '' saat filter
    -- tanggal tidak aktif. OR di SQL tidak dijamin short-circuit, jadi cast tetap
    -- dievaluasi walau guard IS NULL true — CAST('' AS date) melempar error.
    OR u.tglbukti BETWEEN NULLIF(current_setting('tas.bl_tgldari', true), '')::date
                      AND NULLIF(current_setting('tas.bl_tglsampai', true), '')::date
  )
),
tempjadwal AS (
  SELECT
    p.id,
    p.voyberangkat,
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
  u.tglberangkat,
  u.shippinginstruction_nobukti,
  u.info,
  u.modifiedby,
  u.created_at,
  u.updated_at,
  j.voyberangkat,
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
--    TANPA filter session context. bl_id tetap dikirim service sebagai WHERE
--    eksplisit — lihat catatan di bawah file ini.
--
--    Kolom shipping instruction (asalpelabuhan/consignee/shipper/comodity/
--    notifyparty + status pisah BL) memang ditampilkan grid detail BL apa
--    adanya dari SI, dijoin lewat shippinginstructiondetail_nobukti.
--
--    statuspisahbl_memo dipulangkan MENTAH (text berisi JSON). Grid yang
--    JSON.parse lalu memakai WARNA/WARNATULISAN/SINGKATAN-nya — persis seperti
--    GridShippingInstructionDetail. Nilainya tidak dibongkar di sini supaya
--    tidak ada dua sumber kebenaran untuk isi memo.
-- ============================================================
CREATE OR REPLACE VIEW public.vbldetail AS
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
tempsidetail AS (
  SELECT
    si.shippinginstructiondetail_nobukti,
    si.asalpelabuhan,
    si.consignee,
    si.shipper,
    si.comodity,
    si.notifyparty,
    si.statuspisahbl,
    si.emkl_id,
    si.containerpelayaran_id
  FROM shippinginstructiondetail si
)
SELECT
  p.id,
  p.nobukti,
  p.bl_id,
  p.bl_nobukti,
  p.keterangan,
  p.noblconecting,
  p.shippinginstructiondetail_nobukti,
  p.info,
  p.modifiedby,
  p.created_at,
  p.updated_at,
  si.asalpelabuhan,
  si.consignee,
  si.shipper,
  si.comodity,
  si.notifyparty,
  si.statuspisahbl,
  si.emkl_id,
  si.containerpelayaran_id,
  par.text AS statuspisahbl_nama,
  par.memo AS statuspisahbl_memo,
  emk.nama AS emkllain_nama,
  pel.nama AS pelayaran_nama
FROM bldetail p
LEFT JOIN tempsidetail   si  ON p.shippinginstructiondetail_nobukti
                                = si.shippinginstructiondetail_nobukti
LEFT JOIN tempstatus     par ON si.statuspisahbl         = par.id
LEFT JOIN tempemkl       emk ON si.emkl_id               = emk.id
LEFT JOIN temppelayaran  pel ON si.containerpelayaran_id = pel.id;

-- ============================================================
-- 3. RINCIAN
--    TANPA filter session context, alasan sama dengan detail.
--
--    Kolom biaya (biayatruckingmuat, biayadokumenbl, dst) TIDAK ada di sini:
--    daftarnya dinamis mengikuti isi tabel biayaemkl yang statusbiayabl = YA,
--    jadi tetap dirakit sebagai pivot di service. Yang statis — nocontainer &
--    noseal dari orderan muatan — dipindah ke view.
-- ============================================================
CREATE OR REPLACE VIEW public.vbldetailrincian AS
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
  p.bldetail_id,
  p.bldetail_nobukti,
  p.orderanmuatan_nobukti,
  p.keterangan,
  p.info,
  p.modifiedby,
  p.created_at,
  p.updated_at,
  q.nocontainer,
  q.noseal,
  q.shipper_id,
  r.nama AS shipper_nama
FROM bldetailrincian p
LEFT JOIN temporderan q ON p.orderanmuatan_nobukti = q.nobukti
LEFT JOIN tempshipper r ON q.shipper_id            = r.id;

-- ============================================================
-- 4. INDEX PENDUKUNG
--    findAll header SELALU menyaring tglbukti lalu mengurutkan + offset/limit;
--    findAll detail SELALU menyaring bl_id; findAll rincian SELALU menyaring
--    bldetail_id. Tanpa index ini setiap pergeseran window men-scan seluruh
--    tabel.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_blheader_tglbukti
  ON blheader (tglbukti);
CREATE INDEX IF NOT EXISTS idx_blheader_schedule_id
  ON blheader (schedule_id);
CREATE INDEX IF NOT EXISTS idx_bldetail_bl_id
  ON bldetail (bl_id);
CREATE INDEX IF NOT EXISTS idx_bldetail_bl_id_id
  ON bldetail (bl_id, id);
CREATE INDEX IF NOT EXISTS idx_bldetail_sidetail_nobukti
  ON bldetail (shippinginstructiondetail_nobukti);
CREATE INDEX IF NOT EXISTS idx_bldetailrincian_bldetail_id
  ON bldetailrincian (bldetail_id);
CREATE INDEX IF NOT EXISTS idx_bldetailrincian_bldetail_id_id
  ON bldetailrincian (bldetail_id, id);
CREATE INDEX IF NOT EXISTS idx_bldetailrincian_orderanmuatan
  ON bldetailrincian (orderanmuatan_nobukti);

/*
  Kenapa detail & rincian TIDAK ikut memakai session context:

  Untuk header, filter tanggal cuma mempersempit daftar — kalau GUC lupa di-set,
  paling buruk grid menampilkan semua periode. Tidak merusak data.

  Untuk detail & rincian beda: bl_id / bldetail_id bukan sekadar filter
  tampilan. FormBlHeader memakai hasil endpoint ini sebagai payload simpan, dan
  create() MENGHAPUS baris yang tidak ada di payload. Kalau GUC lupa di-set,
  view memulangkan SELURUH detail milik semua BL — dan itu ikut terkirim saat
  simpan. Predikat sepenting itu dibiarkan eksplisit di service supaya tidak
  bisa hilang diam-diam.
*/
