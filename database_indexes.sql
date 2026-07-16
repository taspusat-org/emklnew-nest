-- ============================================
-- CRITICAL DATABASE INDEXES
-- untuk Optimasi Running Number Performance
-- ============================================
-- 
-- INSTRUKSI:
-- 1. Backup database sebelum menjalankan script ini
-- 2. Buka SQL Server Management Studio
-- 3. Connect ke database server
-- 4. Ganti 'emkl_nest' dengan nama database Anda
-- 5. Execute script ini (F5)
-- 6. Tunggu sampai selesai (2-5 menit)
--
-- ============================================

USE [emkl_nest]; -- ⚠️ GANTI dengan nama database Anda
GO

PRINT '';
PRINT '============================================';
PRINT 'Starting Index Creation Process...';
PRINT 'Date: ' + CONVERT(VARCHAR, GETDATE(), 120);
PRINT '============================================';
PRINT '';

-- ============================================
-- 1. PENGELUARANHEADER (MOST CRITICAL!)
-- ============================================
PRINT 'Creating index on pengeluaranheader...';
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_pengeluaranheader_tglbukti_nobukti')
BEGIN
    CREATE NONCLUSTERED INDEX idx_pengeluaranheader_tglbukti_nobukti
    ON pengeluaranheader (tglbukti DESC, nobukti DESC)
    INCLUDE (id, statusformat, relasi_id, bank_id)
    WITH (
        ONLINE = ON,
        FILLFACTOR = 90,
        PAD_INDEX = ON,
        SORT_IN_TEMPDB = ON
    );
    PRINT '✓ Index idx_pengeluaranheader_tglbukti_nobukti created';
END
ELSE
    PRINT '○ Index idx_pengeluaranheader_tglbukti_nobukti already exists';
GO

-- ============================================
-- 2. KASGANTUNGHEADER
-- ============================================
PRINT 'Creating index on kasgantungheader...';
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_kasgantungheader_tglbukti_nobukti')
BEGIN
    CREATE NONCLUSTERED INDEX idx_kasgantungheader_tglbukti_nobukti
    ON kasgantungheader (tglbukti DESC, nobukti DESC)
    INCLUDE (id, pengeluaran_nobukti, relasi_id, bank_id)
    WITH (
        ONLINE = ON,
        FILLFACTOR = 90,
        PAD_INDEX = ON,
        SORT_IN_TEMPDB = ON
    );
    PRINT '✓ Index idx_kasgantungheader_tglbukti_nobukti created';
END
ELSE
    PRINT '○ Index idx_kasgantungheader_tglbukti_nobukti already exists';
GO

-- ============================================
-- 3. PENGEMBALIANKASGANTUNGHEADER
-- ============================================
PRINT 'Creating index on pengembaliankasgantungheader...';
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_pengembaliankasgantungheader_tglbukti_nobukti')
BEGIN
    CREATE NONCLUSTERED INDEX idx_pengembaliankasgantungheader_tglbukti_nobukti
    ON pengembaliankasgantungheader (tglbukti DESC, nobukti DESC)
    INCLUDE (id, coakasmasuk)
    WITH (
        ONLINE = ON,
        FILLFACTOR = 90,
        PAD_INDEX = ON,
        SORT_IN_TEMPDB = ON
    );
    PRINT '✓ Index idx_pengembaliankasgantungheader_tglbukti_nobukti created';
END
ELSE
    PRINT '○ Index idx_pengembaliankasgantungheader_tglbukti_nobukti already exists';
GO

-- ============================================
-- 4. JURNALUMUMHEADER
-- ============================================
PRINT 'Creating index on jurnalumumheader...';
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_jurnalumumheader_tglbukti_nobukti')
BEGIN
    CREATE NONCLUSTERED INDEX idx_jurnalumumheader_tglbukti_nobukti
    ON jurnalumumheader (tglbukti DESC, nobukti DESC)
    INCLUDE (id, statusformat, postingdari)
    WITH (
        ONLINE = ON,
        FILLFACTOR = 90,
        PAD_INDEX = ON,
        SORT_IN_TEMPDB = ON
    );
    PRINT '✓ Index idx_jurnalumumheader_tglbukti_nobukti created';
END
ELSE
    PRINT '○ Index idx_jurnalumumheader_tglbukti_nobukti already exists';
GO

-- ============================================
-- 5. PENGELUARANEMKLHEADER
-- ============================================
PRINT 'Creating index on pengeluaranemklheader...';
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_pengeluaranemklheader_tglbukti_nobukti')
BEGIN
    CREATE NONCLUSTERED INDEX idx_pengeluaranemklheader_tglbukti_nobukti
    ON pengeluaranemklheader (tglbukti DESC, nobukti DESC)
    INCLUDE (id, coaproses, pengeluaran_nobukti)
    WITH (
        ONLINE = ON,
        FILLFACTOR = 90,
        PAD_INDEX = ON,
        SORT_IN_TEMPDB = ON
    );
    PRINT '✓ Index idx_pengeluaranemklheader_tglbukti_nobukti created';
END
ELSE
    PRINT '○ Index idx_pengeluaranemklheader_tglbukti_nobukti already exists';
GO

-- ============================================
-- 6. PENERIMAANEMKLHEADER
-- ============================================
PRINT 'Creating index on penerimaanemklheader...';
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_penerimaanemklheader_tglbukti_nobukti')
BEGIN
    CREATE NONCLUSTERED INDEX idx_penerimaanemklheader_tglbukti_nobukti
    ON penerimaanemklheader (tglbukti DESC, nobukti DESC)
    INCLUDE (id, coaproses, penerimaan_nobukti, pengeluaran_nobukti)
    WITH (
        ONLINE = ON,
        FILLFACTOR = 90,
        PAD_INDEX = ON,
        SORT_IN_TEMPDB = ON
    );
    PRINT '✓ Index idx_penerimaanemklheader_tglbukti_nobukti created';
END
ELSE
    PRINT '○ Index idx_penerimaanemklheader_tglbukti_nobukti already exists';
GO

-- ============================================
-- ADDITIONAL PERFORMANCE INDEXES
-- ============================================

PRINT '';
PRINT 'Creating additional performance indexes...';
PRINT '';

-- 7. Index untuk lookup pengeluaranemkl (digunakan di loop validation)
PRINT 'Creating index on pengeluaranemkl.coaproses...';
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_pengeluaranemkl_coaproses')
BEGIN
    CREATE NONCLUSTERED INDEX idx_pengeluaranemkl_coaproses
    ON pengeluaranemkl (coaproses)
    INCLUDE (nilaiprosespengeluaran, nilaiprosespenerimaan, format)
    WITH (
        ONLINE = ON,
        FILLFACTOR = 90,
        PAD_INDEX = ON
    );
    PRINT '✓ Index idx_pengeluaranemkl_coaproses created';
END
ELSE
    PRINT '○ Index idx_pengeluaranemkl_coaproses already exists';
GO

-- 8. Index untuk lookup penerimaanemkl
PRINT 'Creating index on penerimaanemkl.coaproses...';
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_penerimaanemkl_coaproses')
BEGIN
    CREATE NONCLUSTERED INDEX idx_penerimaanemkl_coaproses
    ON penerimaanemkl (coaproses)
    INCLUDE (format)
    WITH (
        ONLINE = ON,
        FILLFACTOR = 90,
        PAD_INDEX = ON
    );
    PRINT '✓ Index idx_penerimaanemkl_coaproses created';
END
ELSE
    PRINT '○ Index idx_penerimaanemkl_coaproses already exists';
GO

-- 9. Index untuk pengeluarandetail nobukti lookup
PRINT 'Creating index on pengeluarandetail.nobukti...';
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_pengeluarandetail_nobukti')
BEGIN
    CREATE NONCLUSTERED INDEX idx_pengeluarandetail_nobukti
    ON pengeluarandetail (nobukti)
    INCLUDE (id, pengeluaran_id, coadebet, nominal, keterangan)
    WITH (
        ONLINE = ON,
        FILLFACTOR = 90,
        PAD_INDEX = ON
    );
    PRINT '✓ Index idx_pengeluarandetail_nobukti created';
END
ELSE
    PRINT '○ Index idx_pengeluarandetail_nobukti already exists';
GO

-- 10. Index untuk kasgantungdetail nobukti
PRINT 'Creating index on kasgantungdetail.nobukti...';
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_kasgantungdetail_nobukti')
BEGIN
    CREATE NONCLUSTERED INDEX idx_kasgantungdetail_nobukti
    ON kasgantungdetail (nobukti)
    INCLUDE (id, kasgantung_id, keterangan, nominal)
    WITH (
        ONLINE = ON,
        FILLFACTOR = 90,
        PAD_INDEX = ON
    );
    PRINT '✓ Index idx_kasgantungdetail_nobukti created';
END
ELSE
    PRINT '○ Index idx_kasgantungdetail_nobukti already exists';
GO

-- 11. Index untuk pengembaliankasgantungdetail lookup
PRINT 'Creating index on pengembaliankasgantungdetail.kasgantung_nobukti...';
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_pengembaliankasgantungdetail_kasgantung_nobukti')
BEGIN
    CREATE NONCLUSTERED INDEX idx_pengembaliankasgantungdetail_kasgantung_nobukti
    ON pengembaliankasgantungdetail (kasgantung_nobukti)
    INCLUDE (id, pengembaliankasgantung_id, nominal, keterangan)
    WITH (
        ONLINE = ON,
        FILLFACTOR = 90,
        PAD_INDEX = ON
    );
    PRINT '✓ Index idx_pengembaliankasgantungdetail_kasgantung_nobukti created';
END
ELSE
    PRINT '○ Index idx_pengembaliankasgantungdetail_kasgantung_nobukti already exists';
GO

-- ============================================
-- UPDATE STATISTICS
-- ============================================

PRINT '';
PRINT 'Updating statistics for optimal query planning...';
PRINT '';

UPDATE STATISTICS pengeluaranheader WITH FULLSCAN;
PRINT '✓ Statistics updated for pengeluaranheader';

UPDATE STATISTICS kasgantungheader WITH FULLSCAN;
PRINT '✓ Statistics updated for kasgantungheader';

UPDATE STATISTICS pengembaliankasgantungheader WITH FULLSCAN;
PRINT '✓ Statistics updated for pengembaliankasgantungheader';

UPDATE STATISTICS jurnalumumheader WITH FULLSCAN;
PRINT '✓ Statistics updated for jurnalumumheader';

UPDATE STATISTICS pengeluaranemklheader WITH FULLSCAN;
PRINT '✓ Statistics updated for pengeluaranemklheader';

UPDATE STATISTICS penerimaanemklheader WITH FULLSCAN;
PRINT '✓ Statistics updated for penerimaanemklheader';

UPDATE STATISTICS pengeluaranemkl WITH FULLSCAN;
PRINT '✓ Statistics updated for pengeluaranemkl';

UPDATE STATISTICS penerimaanemkl WITH FULLSCAN;
PRINT '✓ Statistics updated for penerimaanemkl';

UPDATE STATISTICS pengeluarandetail WITH FULLSCAN;
PRINT '✓ Statistics updated for pengeluarandetail';

UPDATE STATISTICS kasgantungdetail WITH FULLSCAN;
PRINT '✓ Statistics updated for kasgantungdetail';

UPDATE STATISTICS pengembaliankasgantungdetail WITH FULLSCAN;
PRINT '✓ Statistics updated for pengembaliankasgantungdetail';

-- ============================================
-- SUMMARY & VERIFICATION
-- ============================================

PRINT '';
PRINT '============================================';
PRINT 'INDEX CREATION COMPLETED!';
PRINT '============================================';
PRINT '';
PRINT 'Summary of created indexes:';
PRINT '';

SELECT 
    OBJECT_NAME(i.object_id) AS TableName,
    i.name AS IndexName,
    i.type_desc AS IndexType,
    CASE 
        WHEN i.name LIKE 'idx_%_tglbukti_nobukti' THEN '🔴 Critical'
        WHEN i.name LIKE 'idx_%_coaproses' THEN '🟡 Important'
        ELSE '🟢 Performance'
    END AS Priority,
    (
        SELECT COUNT(*) 
        FROM sys.index_columns ic 
        WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
    ) AS ColumnCount
FROM sys.indexes i
WHERE i.name LIKE 'idx_%'
    AND OBJECT_NAME(i.object_id) IN (
        'pengeluaranheader',
        'kasgantungheader',
        'pengembaliankasgantungheader',
        'jurnalumumheader',
        'pengeluaranemklheader',
        'penerimaanemklheader',
        'pengeluaranemkl',
        'penerimaanemkl',
        'pengeluarandetail',
        'kasgantungdetail',
        'pengembaliankasgantungdetail'
    )
ORDER BY 
    CASE 
        WHEN i.name LIKE 'idx_%_tglbukti_nobukti' THEN 1
        WHEN i.name LIKE 'idx_%_coaproses' THEN 2
        ELSE 3
    END,
    TableName;

PRINT '';
PRINT '============================================';
PRINT 'Next Steps:';
PRINT '1. Test create kas gantung - should be fast now!';
PRINT '2. Monitor index usage after 24 hours';
PRINT '3. Schedule monthly index maintenance';
PRINT '============================================';
PRINT '';
PRINT 'Completion time: ' + CONVERT(VARCHAR, GETDATE(), 120);

GO
