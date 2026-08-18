/*
  View harga trucking (Postgres).

  Konteks: view `vhargatrucking` sudah ada di database tapi TIDAK pernah punya
  file definisi di repo, jadi bentuknya tidak bisa direproduksi ulang. Bentuk
  yang terlanjur ada memakai `p.text` / `p.memo` polos, padahal
  HargatruckingService.findAll() (dan export + orderBy-nya) menyeleksi
  `vht.statusaktif_text` dan `vht.statusaktif_memo`, sehingga setiap GET
  /hargatrucking gagal:

    error: column vht.statusaktif_text does not exist (SQLSTATE 42703)

  Akibatnya lookup HARGA TRUCKING di form booking orderan muatan kosong/error.

  Penamaan kolom status di sini mengikuti view yang sudah lebih dulu memakai
  pola ini — vtypeakuntansi, vmenus, vusers, vgroupbiayaextra — yaitu:

    p.text AS statusaktif_text,
    p.memo AS statusaktif_memo

  (Pola `text`/`memo` polos memang dipakai valatbayar, tapi di sana SELURUH
  rantainya ikut: service menyeleksi `ab.text` dan grid membaca `row.text`.
  Untuk harga trucking rantainya sudah `statusaktif_*` sampai ke frontend —
  lib/types/hargatrucking.type.ts dan GridHargatrucking membaca
  `statusaktif_text`/`statusaktif_memo` — jadi view-nya yang diselaraskan,
  bukan sebaliknya.)

  `count(*) OVER () AS __total_items` dipertahankan apa adanya dari definisi
  lama supaya perilaku pagination tidak berubah.

  Jalankan sekali:
    psql -d <db> -f create-vhargatrucking-pg.sql

  Catatan re-run: CREATE OR REPLACE VIEW di Postgres hanya boleh MENAMBAH kolom
  di akhir. Karena script ini MENGGANTI NAMA kolom `text`/`memo` menjadi
  `statusaktif_text`/`statusaktif_memo`, Postgres akan menolak dengan "cannot
  change name of view column". Jalankan DROP-nya dulu — bungkus dalam satu
  transaksi supaya view tidak pernah hilang bagi request yang sedang jalan:

    BEGIN;
    DROP VIEW IF EXISTS public.vhargatrucking;
    -- lalu isi CREATE OR REPLACE VIEW di bawah
    COMMIT;
*/

CREATE OR REPLACE VIEW public.vhargatrucking AS
SELECT
    ht.id,
    ht.tarifdetail_id,
    ht.emkl_id,
    e.nama          AS emkl_text,
    ht.keterangan,
    ht.container_id,
    ht.tujuankapal_id,
    tk.nama         AS tujuankapal_text,
    c.nama          AS container_text,
    ht.jenisorder_id,
    jo.nama         AS jenisorder_text,
    ht.statusaktif,
    p.text          AS statusaktif_text,
    p.memo          AS statusaktif_memo,
    ht.nominal,
    ht.info,
    ht.modifiedby,
    ht.created_at,
    ht.updated_at,
    count(*) OVER () AS __total_items
FROM hargatrucking ht
    LEFT JOIN parameter p    ON ht.statusaktif    = p.id
    LEFT JOIN tujuankapal tk ON ht.tujuankapal_id = tk.id
    LEFT JOIN emkl e         ON ht.emkl_id        = e.id
    LEFT JOIN container c    ON ht.container_id   = c.id
    LEFT JOIN jenisorder jo  ON ht.jenisorder_id  = jo.id;
