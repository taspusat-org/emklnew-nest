/*
  vhutangdetail — port arsitektur vpengeluarandetail ke modul hutang.

  Sama seperti vpengeluarandetail: coa_text & link jadi kolom view supaya findAll
  tidak perlu JOIN + membangun link di tiap request. Itu syarat agar windowed
  pagination (grid menarik 5 halaman sekaligus) tetap murah.

  BEDA PENTING dari pengeluarandetail: kolom hutangdetail.tglinvoiceemkl bertipe
  TEXT, bukan date, dan isinya bercampur:
      '2026-01-10'  (ISO, hasil formatDateToSQL)
      '04-10-2025'  (DD-MM-YYYY, data lama)
      ''            (string kosong)
      NULL
  Query lama memakai FORMAT(... , 'dd-MM-yyyy') — fungsi SQL Server, tak ada di
  PG — dan `p.tglinvoiceemkl::timestamp` yang meledak pada '' dan pada format
  DD-MM-YYYY. View menormalkan semuanya ke DATE sungguhan lewat regex guard,
  sehingga service bisa TO_CHAR(...,'DD-MM-YYYY') persis seperti pengeluaran dan
  filter tanggal (>=, <=) bekerja sebagai tanggal, bukan perbandingan string.
  Baris yang formatnya tak dikenal jadi NULL, bukan error.
*/
CREATE OR REPLACE VIEW public.vhutangdetail AS
SELECT
  p.id,
  p.hutang_id,
  p.nobukti,
  p.coa,
  p.keterangan,
  p.nominal,
  p.dpp,
  p.noinvoiceemkl,
  CASE
    WHEN p.tglinvoiceemkl ~ '^\d{4}-\d{2}-\d{2}'
      THEN to_date(left(p.tglinvoiceemkl, 10), 'YYYY-MM-DD')
    WHEN p.tglinvoiceemkl ~ '^\d{2}-\d{2}-\d{4}$'
      THEN to_date(p.tglinvoiceemkl, 'DD-MM-YYYY')
    ELSE NULL
  END AS tglinvoiceemkl,
  p.nofakturpajakemkl,
  p.info,
  p.modifiedby,
  p.created_at,
  p.updated_at,
  q.keterangancoa AS coa_text,
  -- chr(63) = '?', BUKAN literal '?': file ini juga dijalankan lewat knex.raw
  -- yang memperlakukan '?' sebagai placeholder binding positional. Sama dengan
  -- vpengeluarandetail.
  '<a target="_blank" className="link-color" href="/dashboard/hutang'
    || chr(63) || 'nobukti=' || p.nobukti
    || '"><HighlightWrapper value="' || p.nobukti || '" /></a>' AS link
FROM hutangdetail p
LEFT JOIN akunpusat q ON p.coa = q.coa;
