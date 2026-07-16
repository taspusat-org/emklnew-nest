/*
  FIX: vpengeluaranheader -> 500 "Conversion failed when converting the varchar
  value '02-...' to data type int" saat grid Pengeluaran difilter per-bank.

  Penyebab: bank.id / pengeluaranheader.bank_id = varchar(200) (UUID), tetapi
  view memfilter dengan:
        OR u.bank_id = CAST(SESSION_CONTEXT(N'bank_id') AS INT)
  Saat ada filter bank aktif, backend men-set SESSION_CONTEXT('bank_id') ke UUID,
  lalu CAST(... AS INT) gagal (SQL 245) -> findAll 500.

  Perbaikan: bandingkan sebagai VARCHAR(200) (sesuai tipe kolom bank_id).
  Dijalankan langsung ke DB tasemkl 2026-06-24. Simpan di sini karena definisi
  view tidak ada di repo.
*/
ALTER VIEW [dbo].[vpengeluaranheader]
AS
WITH temp_url AS (
    SELECT
        ph.id,
        ph.nobukti AS nobukti_key,
        STRING_AGG(
            CAST(
                '<a target="_blank" className="link-color" href="/dashboard/jurnalumumheader?' +
                'nobukti=' + ph.nobukti + '">' +
                '<HighlightWrapper value="' + ph.nobukti + '" />' +
                '</a>'
            AS NVARCHAR(MAX))
        , ',') AS link
    FROM dbo.pengeluaranheader AS ph WITH (READUNCOMMITTED)
        WHERE (
        SESSION_CONTEXT(N'tgldari') IS NULL
        OR SESSION_CONTEXT(N'tglsampai') IS NULL
        OR (
            ph.tglbukti BETWEEN CAST(SESSION_CONTEXT(N'tgldari') AS DATETIME) AND CAST(SESSION_CONTEXT(N'tglsampai') AS DATETIME)
        )
    )
    GROUP BY ph.id, ph.nobukti
)
SELECT
    [u].[id],
    [u].[nobukti],
    [u].[tglbukti],
    [u].[relasi_id],
    [u].[keterangan],
    [u].[bank_id],
    [u].[postingdari],
    [u].[coakredit],
    [u].[dibayarke],
    [u].[alatbayar_id],
    [u].[nowarkat],
    [u].[tgljatuhtempo],
    [u].[pengeluaranemklgantung_nobukti],
    [u].[penerimaanemklgantung_nobukti],
    [u].[daftarbank_id],
    [u].[statusformat],
    [u].[modifiedby],
    [u].[created_at],
    [u].[updated_at],
    [r].[nama]          AS [relasi_text],
    [b].[nama]          AS [bank_text],
    [a].[keterangancoa] AS [coakredit_text],
    [c].[nama]          AS [alatbayar_text],
    [d].[nama]          AS [daftarbank_text],
    [t].[link]
FROM dbo.pengeluaranheader AS u WITH (READUNCOMMITTED)
LEFT JOIN dbo.relasi        AS r WITH (READUNCOMMITTED) ON [u].[relasi_id]    = [r].[id]
LEFT JOIN dbo.bank          AS b WITH (READUNCOMMITTED) ON [u].[bank_id]      = [b].[id]
LEFT JOIN dbo.akunpusat     AS a WITH (READUNCOMMITTED) ON [u].[coakredit]    = [a].[coa]
LEFT JOIN dbo.alatbayar     AS c WITH (READUNCOMMITTED) ON [u].[alatbayar_id] = [c].[id]
LEFT JOIN dbo.daftarbank    AS d WITH (READUNCOMMITTED) ON [u].[daftarbank_id]= [d].[id]
LEFT JOIN temp_url          AS t                        ON [u].[nobukti]      = [t].[nobukti_key]
WHERE (
    SESSION_CONTEXT(N'tgldari') IS NULL
    OR SESSION_CONTEXT(N'tglsampai') IS NULL
    OR (
        u.tglbukti BETWEEN
        CAST(SESSION_CONTEXT(N'tgldari') AS DATETIME)
        AND CAST(SESSION_CONTEXT(N'tglsampai') AS DATETIME)
    )
)
AND (
    SESSION_CONTEXT(N'bank_id') IS NULL
    OR u.bank_id = CAST(SESSION_CONTEXT(N'bank_id') AS VARCHAR(200))
);
