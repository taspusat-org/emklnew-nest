-- =====================================================================
-- View Menu
--
-- Jalankan manual di pgAdmin pada database `tasemkl`, schema `public`.
-- Dipakai MenuService (findAll, count, hitung posisi baris, hasil
-- create/update, findAllByIds, export) — polanya sama dengan
-- vgroupbiayaextra / vtypeakuntansi / vparameter.
--
-- Tiga join yang selama ini ditulis ulang di baseQuery diangkat ke sini,
-- termasuk SELF JOIN ke `menus` sendiri untuk mengambil judul menu induk.
--
-- Script ini idempotent: aman dijalankan ulang.
-- =====================================================================

DROP VIEW IF EXISTS public.vmenus;

CREATE VIEW public.vmenus AS
SELECT
    u.id,
    u.title,
    u.aco_id,
    u.icon,
    -- Nama kolom fisik dibiarkan huruf kecil (parentid/isactive) persis seperti
    -- di tabel; service yang meng-alias-kannya ke camelCase saat select supaya
    -- kontrak JSON ke frontend tidak berubah.
    u.parentid,
    u.isactive,
    u."order",
    u.statusaktif,
    u.modifiedby,
    -- created_at/updated_at sengaja MENTAH (timestamp): service memformatnya
    -- sendiri saat select, dan perhitungan posisi baris membandingkan kolom
    -- ini sebagai tanggal. Kalau di-TO_CHAR di sini urutannya jadi urutan
    -- string ("01-12-2024" < "02-01-2020").
    u.created_at,
    u.updated_at,
    p.text  AS statusaktif_text,
    p.memo  AS statusaktif_memo,
    a.nama  AS acos_nama,
    a.class AS acos_class,
    parent.title AS parent_nama
FROM menus u
LEFT JOIN menus      parent ON u.parentid    = parent.id
LEFT JOIN parameter  p      ON u.statusaktif = p.id
LEFT JOIN acos       a      ON u.aco_id      = a.id;

COMMENT ON VIEW public.vmenus IS
  'Menu + teks status aktif, nama aco, dan judul menu induk. Dibaca MenuService (findAll/create/update/findAllByIds/export).';

-- ---------------------------------------------------------------------
-- Index penunjang (opsional, jalankan sekali)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_menus_parentid
    ON public.menus (parentid);

CREATE INDEX IF NOT EXISTS idx_menus_statusaktif
    ON public.menus (statusaktif);

CREATE INDEX IF NOT EXISTS idx_menus_aco_id
    ON public.menus (aco_id);
