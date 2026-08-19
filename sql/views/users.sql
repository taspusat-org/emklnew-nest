-- =====================================================================
-- View User
--
-- Jalankan manual di pgAdmin pada database `tasemkl`, schema `public`.
-- Dipakai UserService (findAll, count, hitung posisi baris, hasil
-- create/update, findAllByIds, getById, export) — polanya sama dengan
-- vtypeakuntansi / vmenus / vparameter.
--
-- Script ini idempotent: aman dijalankan ulang.
-- =====================================================================

DROP VIEW IF EXISTS public.vusers;

CREATE VIEW public.vusers AS
SELECT
    u.id,
    u.username,
    u.name,
    u.email,
    u.cabang_id,
    u.statusaktif,
    u.modifiedby,
    -- created_at/updated_at sengaja MENTAH (timestamp), bukan teks TO_CHAR:
    -- service memformatnya sendiri saat select, dan perhitungan posisi baris
    -- membandingkan nilai kolom ini sebagai tanggal. Kalau di-TO_CHAR di sini,
    -- urutannya jadi urutan string ("01-12-2024" < "02-01-2020").
    u.created_at,
    u.updated_at,
    p.text AS statusaktif_text,
    p.memo AS statusaktif_memo,
    c.nama AS cabang_nama
FROM users u
LEFT JOIN parameter p ON u.statusaktif = p.id
LEFT JOIN cabang    c ON u.cabang_id   = c.id;

-- `password` dan `menu` SENGAJA tidak ikut: view ini dipakai jalur baca grid
-- (findAll/getById/export) yang hasilnya dikirim apa adanya ke frontend, jadi
-- hash password tidak boleh ikut terbawa. `menu` bertipe teks panjang dan tidak
-- pernah ditampilkan di grid. Keduanya tetap dibaca lewat tabel `users` langsung
-- oleh AuthService dan UserService.update.
COMMENT ON VIEW public.vusers IS
  'User + teks status aktif & nama cabang, tanpa password/menu. Dibaca UserService (findAll/create/update/findAllByIds/getById/export).';

-- ---------------------------------------------------------------------
-- Index penunjang (opsional, jalankan sekali)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_statusaktif
    ON public.users (statusaktif);

CREATE INDEX IF NOT EXISTS idx_users_cabang_id
    ON public.users (cabang_id);
