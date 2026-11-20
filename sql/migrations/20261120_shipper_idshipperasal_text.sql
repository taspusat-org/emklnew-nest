-- shipper.idshipperasal: bigint -> text (UUID shipper.id), sama seperti parentshipper_id.
-- Lookup SHIPPER ASAL mengirim shipper.id (UUID); bigint menolaknya.
-- Aman dijalankan ulang: dibatalkan kalau ada baris terisi (id numerik lama
-- tidak bisa dipetakan ke UUID).
BEGIN;

DO $$
DECLARE terisi int; tipe text;
BEGIN
  SELECT data_type INTO tipe FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'shipper' AND column_name = 'idshipperasal';
  IF tipe = 'text' THEN
    RAISE NOTICE 'idshipperasal sudah text, dilewati';
    RETURN;
  END IF;
  SELECT count(*) INTO terisi FROM shipper WHERE idshipperasal IS NOT NULL;
  IF terisi > 0 THEN
    RAISE EXCEPTION 'idshipperasal berisi % baris numerik lama; petakan ke UUID dulu', terisi;
  END IF;
  ALTER TABLE shipper ALTER COLUMN idshipperasal TYPE text USING idshipperasal::text;
END $$;

COMMIT;
