/*
  View vpengeluarandetail (Postgres).

  Konteks: PengeluarandetailService.findAll() dulu query langsung ke tabel base
  `pengeluarandetail` + LEFT JOIN akunpusat, dan membangun kolom `link` lewat
  temp table `##temp_url_x` + STRING_AGG (sisa SQL Server). Sekarang polanya
  disamakan dengan alatbayar/pengeluaranheader: tabel base untuk tulis, VIEW
  untuk baca. View memuat kolom turunan (coadebet_text, link) sehingga service
  cukup SELECT + filter + paginate tanpa JOIN berulang di tiap request — syarat
  supaya windowed pagination (5 halaman) murah saat di-scroll.

  Beda dgn vpengeluaranheader: TIDAK ada klausa WHERE berbasis GUC
  (current_setting('tas.*')). Detail selalu dipersempit oleh nobukti dari header
  yang sedang dipilih, jadi tak perlu filter tanggal/bank di level view.

  Catatan:
    - chr(63) = '?'. Dipakai (bukan '?' literal) karena string view ini juga
      dipakai lewat knex.raw di beberapa tooling, dan '?' di sana ditafsirkan
      sebagai bind placeholder.
    - nobukti NOT NULL DEFAULT '' sehingga concat `link` tidak pernah jadi NULL.

  Jalankan: psql -d <db> -f create-vpengeluarandetail-pg.sql
*/
CREATE OR REPLACE VIEW public.vpengeluarandetail AS
SELECT
  p.id,
  p.pengeluaran_id,
  p.coadebet,
  p.nobukti,
  p.keterangan,
  p.nominal,
  p.dpp,
  p.transaksibiaya_nobukti,
  p.transaksilain_nobukti,
  p.noinvoiceemkl,
  p.tglinvoiceemkl,
  p.nofakturpajakemkl,
  p.perioderefund,
  p.pengeluaranemklheader_nobukti,
  p.penerimaanemklheader_nobukti,
  p.kasgantung_nobukti,
  p.info,
  p.modifiedby,
  p.created_at,
  p.updated_at,
  q.keterangancoa AS coadebet_text,
  '<a target="_blank" className="link-color" href="/dashboard/pengeluaran'
    || chr(63) || 'nobukti=' || p.nobukti || '">'
    || '<HighlightWrapper value="' || p.nobukti || '" />'
    || '</a>' AS link
FROM pengeluarandetail p
LEFT JOIN akunpusat q ON p.coadebet = q.coa;

-- Index pendukung: findAll SELALU memfilter nobukti (guard di service) lalu
-- mengurutkan + offset/limit. Tanpa index ini setiap halaman men-scan seluruh
-- tabel detail.
CREATE INDEX IF NOT EXISTS idx_pengeluarandetail_nobukti
  ON pengeluarandetail (nobukti);
CREATE INDEX IF NOT EXISTS idx_pengeluarandetail_nobukti_id
  ON pengeluarandetail (nobukti, id);
