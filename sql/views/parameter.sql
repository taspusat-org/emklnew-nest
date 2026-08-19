-- =====================================================================
-- View Parameter
--
-- Jalankan manual di pgAdmin pada database `tasemkl`, schema `public`.
-- Dipakai ParameterService (findAll, count, hitung posisi baris, hasil
-- create/update, findAllByIds, export) — polanya sama dengan
-- vgroupbiayaextra / vtypeakuntansi.
--
-- Berbeda dengan modul lain, `parameter` tidak punya tabel relasi untuk
-- di-join. Yang diangkat view ini adalah isi kolom `memo`: kolomnya bertipe
-- text berisi JSON, dan konsumennya (grid approval, badge status) selama ini
-- membongkarnya lewat ekspresi JSON yang ditulis ulang di setiap query.
--
-- Script ini idempotent: aman dijalankan ulang seluruhnya.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. try_jsonb — cast text->jsonb yang tidak meledak pada baris rusak
--
-- `memo` tidak dijamin JSON valid (baris lama bisa berisi teks biasa atau
-- string kosong). Tanpa penjagaan ini satu baris rusak membuat SELECT * dari
-- view gagal seluruhnya. Sengaja TIDAK memakai `IS JSON` (butuh PostgreSQL 16)
-- supaya script ini jalan di versi berapa pun.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_jsonb(txt text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
BEGIN
  RETURN txt::jsonb;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.try_jsonb(text) IS
  'Cast text ke jsonb; mengembalikan NULL kalau isinya bukan JSON valid. Dipakai vparameter.';

-- ---------------------------------------------------------------------
-- 2. vparameter
--
-- Kolom memo_* di bawah adalah ekspresi skalar (bukan LATERAL) supaya query
-- yang tidak menyebutnya sama sekali tidak ikut membayar biaya parsing JSON.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.vparameter;

CREATE VIEW public.vparameter AS
SELECT
    p.id,
    p.grp,
    p.subgrp,
    p.kelompok,
    p.text,
    p.memo,
    p.type,
    p."default",
    p.info,
    p.modifiedby,
    -- created_at/updated_at sengaja MENTAH (timestamp): service memformatnya
    -- sendiri saat select, dan perhitungan posisi baris membandingkan kolom
    -- ini sebagai tanggal. Kalau di-TO_CHAR di sini urutannya jadi urutan
    -- string ("01-12-2024" < "02-01-2020").
    p.created_at,
    p.updated_at,
    public.try_jsonb(p.memo) ->> 'MEMO'                 AS memo_nama,
    public.try_jsonb(p.memo) ->> 'SINGKATAN'            AS singkatan,
    public.try_jsonb(p.memo) ->> 'WARNA'                AS warna,
    public.try_jsonb(p.memo) ->> 'WARNATULISAN'         AS warna_tulisan,
    public.try_jsonb(p.memo) ->> 'NILAI YA'             AS nilai_ya,
    public.try_jsonb(p.memo) ->> 'NILAI TIDAK'          AS nilai_tidak,
    public.try_jsonb(p.memo) ->> 'ROLE YA'              AS role_ya,
    public.try_jsonb(p.memo) ->> 'ROLE TIDAK'           AS role_tidak,
    public.try_jsonb(p.memo) ->> 'KETERANGAN WAJIB ISI' AS keterangan_wajib_isi,
    public.try_jsonb(p.memo) ->> 'TANGGAL WAJIB ISI'    AS tanggal_wajib_isi,
    public.try_jsonb(p.memo) ->> 'ICON'                 AS icon
FROM parameter p;

COMMENT ON VIEW public.vparameter IS
  'Parameter + isi kolom memo (JSON) yang sudah dibongkar jadi kolom. Dibaca ParameterService (findAll/create/update/findAllByIds/export).';

-- ---------------------------------------------------------------------
-- 3. Index penunjang (opsional, jalankan sekali)
--
-- grp/subgrp adalah kunci lookup yang dipakai hampir seluruh modul untuk
-- mengambil daftar STATUS AKTIF dan sejenisnya.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_parameter_grp_subgrp
    ON public.parameter (grp, subgrp);
