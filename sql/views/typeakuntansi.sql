-- =====================================================================
-- View Type Akuntansi
--
-- Jalankan manual di pgAdmin pada database `tasemkl`, schema `public`.
-- Dipakai TypeAkuntansiService (findAll, count, hitung posisi baris,
-- hasil create/update, export) — polanya sama dengan vgroupbiayaextra.
--
-- Script ini idempotent: aman dijalankan ulang.
-- =====================================================================

DROP VIEW IF EXISTS public.vtypeakuntansi;

CREATE VIEW public.vtypeakuntansi AS
SELECT
    u.id,
    u.nama,
    u."order",
    u.keterangan,
    u.akuntansi_id,
    u.statusaktif,
    u.info,
    u.modifiedby,
    -- created_at/updated_at sengaja MENTAH (timestamp), bukan teks TO_CHAR:
    -- service memformatnya sendiri saat select, dan perhitungan posisi baris
    -- membandingkan nilai kolom ini sebagai tanggal. Kalau di-TO_CHAR di sini,
    -- urutannya jadi urutan string ("01-12-2024" < "02-01-2020").
    u.created_at,
    u.updated_at,
    p.text AS statusaktif_text,
    p.memo AS statusaktif_memo,
    ak.nama AS akuntansi_nama
FROM typeakuntansi u
LEFT JOIN parameter  p  ON u.statusaktif  = p.id
LEFT JOIN akuntansi  ak ON u.akuntansi_id = ak.id;

COMMENT ON VIEW public.vtypeakuntansi IS
  'Type akuntansi + teks status aktif & nama akuntansi. Dibaca TypeAkuntansiService (findAll/create/update/export).';

-- ---------------------------------------------------------------------
-- Index penunjang (opsional, jalankan sekali)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_typeakuntansi_statusaktif
    ON public.typeakuntansi (statusaktif);

CREATE INDEX IF NOT EXISTS idx_typeakuntansi_akuntansi_id
    ON public.typeakuntansi (akuntansi_id);
