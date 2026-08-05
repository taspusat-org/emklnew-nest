/*
  Default COMODITY untuk PROSES shipping instruction.

  Dipakai oleh OrderanMuatanService.processShipping(): nilai `text` di baris ini
  jadi isi awal kolom COMODITY, baik di baris DETAIL maupun di baris RINCIAN,
  setiap kali tombol PROSES ditekan. Ditaruh di `parameter` supaya bisa diubah
  lewat data — tidak perlu deploy ulang.

  Kalau baris ini belum ada, service jatuh ke literal 'GENERAL CARGO', jadi
  aplikasi tetap jalan walau script ini belum dijalankan.

  Mengubah defaultnya nanti cukup:
    UPDATE parameter SET text = 'NILAI BARU'
    WHERE grp = 'COMODITY DEFAULT' AND subgrp = 'SHIPPING INSTRUCTION';

  Jalankan sekali:
    psql -d <db> -f insert-parameter-comodity-default.sql
*/

INSERT INTO parameter (
  id,
  grp,
  subgrp,
  kelompok,
  text,
  modifiedby,
  created_at,
  updated_at
)
SELECT
  -- Format id disamakan dengan utils uuidV7(): '<KODE CABANG>-<uuid v7>'.
  COALESCE(
    (SELECT memo::jsonb ->> 'KODE CABANG'
     FROM parameter
     WHERE grp = 'CABANG' AND subgrp = 'CABANG'
     LIMIT 1),
    '00'
  ) || '-' || public.get_uuid_v7()::text,
  'COMODITY DEFAULT',
  'SHIPPING INSTRUCTION',
  'SHIPPING INSTRUCTION',
  'GENERAL CARGO',
  'ADMIN',
  now(),
  now()
-- Idempoten: aman dijalankan berulang, tidak akan menggandakan baris.
WHERE NOT EXISTS (
  SELECT 1 FROM parameter
  WHERE grp = 'COMODITY DEFAULT' AND subgrp = 'SHIPPING INSTRUCTION'
);
