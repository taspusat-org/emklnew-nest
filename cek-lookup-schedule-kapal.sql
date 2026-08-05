/*
  Diagnostik: kenapa lookup SCHEDULE KAPAL di form Shipping Instruction kosong.

  Lookup itu memakai endpoint:
    schedule-kapal?join=orderanmuatan&notIn={"id":[...]}

  Artinya sebuah schedule baru MUNCUL kalau lolos DUA syarat:
    1. join=orderanmuatan  -> schedule-nya sudah dipakai minimal satu orderan
                              muatan (orderanmuatan.schedule_id = schedulekapal.id)
    2. notIn               -> schedule-nya BELUM dipakai shipping instruction lain
                              (kecuali milik record yang sedang diedit)

  Jalankan query di bawah untuk melihat schedule mana yang tersaring dan kenapa.
*/

SELECT
  sk.id,
  sk.voyberangkat,
  kpl.nama  AS kapal,
  pel.nama  AS pelayaran,
  tjk.nama  AS tujuan,
  sk.tglberangkat,

  -- Syarat 1
  (SELECT count(*) FROM orderanmuatan om WHERE om.schedule_id = sk.id)
    AS jumlah_orderan_muatan,

  -- Syarat 2
  (SELECT count(*) FROM shippinginstructionheader si WHERE si.schedule_id = sk.id)
    AS dipakai_shipping_instruction,

  CASE
    WHEN (SELECT count(*) FROM orderanmuatan om WHERE om.schedule_id = sk.id) = 0
      THEN 'TIDAK MUNCUL - belum ada orderan muatan'
    WHEN (SELECT count(*) FROM shippinginstructionheader si WHERE si.schedule_id = sk.id) > 0
      THEN 'TIDAK MUNCUL - sudah dipakai shipping instruction'
    ELSE 'MUNCUL di lookup'
  END AS status_lookup

FROM schedulekapal sk
LEFT JOIN kapal       kpl ON sk.kapal_id       = kpl.id
LEFT JOIN pelayaran   pel ON sk.pelayaran_id   = pel.id
LEFT JOIN tujuankapal tjk ON sk.tujuankapal_id = tjk.id
ORDER BY sk.tglberangkat DESC NULLS LAST, sk.id DESC;

/*
  Ringkasan cepat — kalau angka pertama 0 untuk semua baris, berarti memang
  belum ada orderan muatan yang menunjuk ke schedule mana pun:

    SELECT
      (SELECT count(*) FROM schedulekapal)                              AS total_schedulekapal,
      (SELECT count(*) FROM orderanmuatan WHERE schedule_id IS NOT NULL) AS orderanmuatan_punya_schedule,
      (SELECT count(DISTINCT schedule_id) FROM orderanmuatan WHERE schedule_id IS NOT NULL) AS schedule_terpakai_orderan,
      (SELECT count(*) FROM shippinginstructionheader WHERE schedule_id IS NOT NULL) AS schedule_terpakai_si;
*/
