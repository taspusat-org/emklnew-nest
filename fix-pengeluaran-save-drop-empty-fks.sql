/*
  Drop FK yang bentrok dengan sentinel '' pada alur SIMPAN pengeluaran.

  Konteks: banyak kolom "link opsional" bertipe text NOT NULL DEFAULT ''. Untuk
  transaksi normal (tanpa link) kolomnya berisi '' — tetapi ada FK NOT VALID ke
  tabel induk yang menolak '' (tak ada nobukti ''), sehingga INSERT saat simpan
  500: "violates foreign key constraint ...". FK ini NOT VALID (data lama tak
  dicek) & validitas link nyata sudah dijamin app lewat lookup, jadi aman di-drop.

  Dijalankan di tasemkl@localhost. WAJIB dijalankan juga di DB tujuan lain
  (mis. server.transporindo.com) bila backend diarahkan ke sana.
*/

-- Header pengeluaran: kolom pengeluaranemklgantung_nobukti = '' langgar FK.
ALTER TABLE pengeluaranheader
  DROP CONSTRAINT IF EXISTS "FK_pengeluaranheader_pengeluaranemklgantungheader_nobukti";

-- Detail pengeluaran: kolom link opsional (kasgantung/penerimaanemkl/pengeluaranemkl)
-- = '' langgar FK. coadebet & pengeluaran_id TIDAK di-drop (nilainya valid).
ALTER TABLE pengeluarandetail
  DROP CONSTRAINT IF EXISTS "FK_pengeluaranDetail_kasgantungheader";
ALTER TABLE pengeluarandetail
  DROP CONSTRAINT IF EXISTS "FK_pengeluaranDetail_penerimaanemklheader_nobukti";
ALTER TABLE pengeluarandetail
  DROP CONSTRAINT IF EXISTS "FK_pengeluaranDetail_pengeluaranemklheader_nobukti";
