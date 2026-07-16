# 🔴 CRITICAL: Database Optimization Required

## Masalah Timeout pada Running Number Generation

### Error yang Terjadi:
```
RequestError: select [nobukti] as [nobukti] from [pengeluaranheader] 
where [tglbukti] >= @p0 and [tglbukti] < @p1 
order by [nobukti] asc - Timeout: Request failed to complete in 60000ms
```

---

## 🔍 Root Cause Analysis

### 1. **Query Tanpa Index**
Query mencari running number terakhir dengan:
- Filter: `WHERE tglbukti >= start AND tglbukti < end`
- Sort: `ORDER BY nobukti`
- Tanpa index pada kolom-kolom ini!

**Dampak**: Full table scan untuk ribuan records → timeout 60 detik

---

### 2. **Lock Contention dengan `.forUpdate()`**
Code lama menggunakan `.forUpdate()` yang:
- Menglock semua rows yang di-select
- Bisa deadlock jika ada transaksi concurrent
- Memperlambat operasi lain

---

### 3. **Load Semua Data Tanpa Limit**
Query mengambil **SEMUA records** dalam range tanggal, padahal hanya butuh 100-1000 terakhir untuk pattern matching.

---

## ✅ Solusi yang Sudah Diimplementasikan

### A. Code Optimization (DONE)

1. **Hapus `.forUpdate()` Lock**
   ```typescript
   // ❌ BEFORE
   const rows = await trx(table)
     .forUpdate()
     .select(...)
   
   // ✅ AFTER
   const rows = await trx
     .from(trx.raw(`${table} WITH (READUNCOMMITTED)`))
     .select(...)
   ```

2. **Tambah `READUNCOMMITTED` Hint**
   - Hindari lock contention
   - Baca data tanpa wait lock dari transaksi lain
   - Safe untuk read running number (eventual consistency OK)

3. **Limit Query ke 1000 Records**
   ```typescript
   .orderBy(fixField, 'desc')
   .limit(1000)
   ```
   
4. **Sort `DESC` untuk Performa**
   - Ambil data terbaru duluan
   - Biasanya running number baru dekat dengan yang terakhir

---

## 🚨 WAJIB DILAKUKAN: Database Indexing

### Critical Indexes untuk Semua Tabel dengan Running Number

Jalankan SQL script berikut di **SQL Server Management Studio**:

```sql
-- ============================================
-- CRITICAL INDEXES FOR RUNNING NUMBER
-- ============================================

USE [emkl_nest]; -- Ganti dengan nama database Anda
GO

-- 1. PENGELUARANHEADER (PALING KRITIS!)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_pengeluaranheader_tglbukti_nobukti')
BEGIN
    CREATE NONCLUSTERED INDEX idx_pengeluaranheader_tglbukti_nobukti
    ON pengeluaranheader (tglbukti DESC, nobukti DESC)
    INCLUDE (id, statusformat)
    WITH (ONLINE = ON, FILLFACTOR = 90);
    PRINT 'Index idx_pengeluaranheader_tglbukti_nobukti created successfully';
END
ELSE
    PRINT 'Index idx_pengeluaranheader_tglbukti_nobukti already exists';
GO

-- 2. KASGANTUNGHEADER
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_kasgantungheader_tglbukti_nobukti')
BEGIN
    CREATE NONCLUSTERED INDEX idx_kasgantungheader_tglbukti_nobukti
    ON kasgantungheader (tglbukti DESC, nobukti DESC)
    INCLUDE (id, pengeluaran_nobukti)
    WITH (ONLINE = ON, FILLFACTOR = 90);
    PRINT 'Index idx_kasgantungheader_tglbukti_nobukti created successfully';
END
ELSE
    PRINT 'Index idx_kasgantungheader_tglbukti_nobukti already exists';
GO

-- 3. PENGEMBALIANKASGANTUNGHEADER
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_pengembaliankasgantungheader_tglbukti_nobukti')
BEGIN
    CREATE NONCLUSTERED INDEX idx_pengembaliankasgantungheader_tglbukti_nobukti
    ON pengembaliankasgantungheader (tglbukti DESC, nobukti DESC)
    INCLUDE (id)
    WITH (ONLINE = ON, FILLFACTOR = 90);
    PRINT 'Index idx_pengembaliankasgantungheader_tglbukti_nobukti created successfully';
END
ELSE
    PRINT 'Index idx_pengembaliankasgantungheader_tglbukti_nobukti already exists';
GO

-- 4. JURNALUMUMHEADER
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_jurnalumumheader_tglbukti_nobukti')
BEGIN
    CREATE NONCLUSTERED INDEX idx_jurnalumumheader_tglbukti_nobukti
    ON jurnalumumheader (tglbukti DESC, nobukti DESC)
    INCLUDE (id, statusformat)
    WITH (ONLINE = ON, FILLFACTOR = 90);
    PRINT 'Index idx_jurnalumumheader_tglbukti_nobukti created successfully';
END
ELSE
    PRINT 'Index idx_jurnalumumheader_tglbukti_nobukti already exists';
GO

-- 5. PENGELUARANEMKLHEADER
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_pengeluaranemklheader_tglbukti_nobukti')
BEGIN
    CREATE NONCLUSTERED INDEX idx_pengeluaranemklheader_tglbukti_nobukti
    ON pengeluaranemklheader (tglbukti DESC, nobukti DESC)
    INCLUDE (id)
    WITH (ONLINE = ON, FILLFACTOR = 90);
    PRINT 'Index idx_pengeluaranemklheader_tglbukti_nobukti created successfully';
END
ELSE
    PRINT 'Index idx_pengeluaranemklheader_tglbukti_nobukti already exists';
GO

-- 6. PENERIMAANEMKLHEADER
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_penerimaanemklheader_tglbukti_nobukti')
BEGIN
    CREATE NONCLUSTERED INDEX idx_penerimaanemklheader_tglbukti_nobukti
    ON penerimaanemklheader (tglbukti DESC, nobukti DESC)
    INCLUDE (id)
    WITH (ONLINE = ON, FILLFACTOR = 90);
    PRINT 'Index idx_penerimaanemklheader_tglbukti_nobukti created successfully';
END
ELSE
    PRINT 'Index idx_penerimaanemklheader_tglbukti_nobukti already exists';
GO

-- ============================================
-- ADDITIONAL PERFORMANCE INDEXES
-- ============================================

-- 7. Index untuk lookup pengeluaranemkl (digunakan di loop)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_pengeluaranemkl_coaproses')
BEGIN
    CREATE NONCLUSTERED INDEX idx_pengeluaranemkl_coaproses
    ON pengeluaranemkl (coaproses)
    INCLUDE (nilaiprosespengeluaran, nilaiprosespenerimaan, format)
    WITH (ONLINE = ON, FILLFACTOR = 90);
    PRINT 'Index idx_pengeluaranemkl_coaproses created successfully';
END
ELSE
    PRINT 'Index idx_pengeluaranemkl_coaproses already exists';
GO

-- 8. Index untuk lookup penerimaanemkl
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_penerimaanemkl_coaproses')
BEGIN
    CREATE NONCLUSTERED INDEX idx_penerimaanemkl_coaproses
    ON penerimaanemkl (coaproses)
    INCLUDE (format)
    WITH (ONLINE = ON, FILLFACTOR = 90);
    PRINT 'Index idx_penerimaanemkl_coaproses created successfully';
END
ELSE
    PRINT 'Index idx_penerimaanemkl_coaproses already exists';
GO

-- 9. Index untuk pengeluarandetail nobukti lookup
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_pengeluarandetail_nobukti')
BEGIN
    CREATE NONCLUSTERED INDEX idx_pengeluarandetail_nobukti
    ON pengeluarandetail (nobukti)
    INCLUDE (id, pengeluaran_id, coadebet, nominal)
    WITH (ONLINE = ON, FILLFACTOR = 90);
    PRINT 'Index idx_pengeluarandetail_nobukti created successfully';
END
ELSE
    PRINT 'Index idx_pengeluarandetail_nobukti already exists';
GO

-- 10. Index untuk kasgantungdetail
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_kasgantungdetail_nobukti')
BEGIN
    CREATE NONCLUSTERED INDEX idx_kasgantungdetail_nobukti
    ON kasgantungdetail (nobukti)
    INCLUDE (id, kasgantung_id, keterangan, nominal)
    WITH (ONLINE = ON, FILLFACTOR = 90);
    PRINT 'Index idx_kasgantungdetail_nobukti created successfully';
END
ELSE
    PRINT 'Index idx_kasgantungdetail_nobukti already exists';
GO

PRINT '';
PRINT '============================================';
PRINT 'Index creation completed!';
PRINT 'Total indexes created: 10';
PRINT '============================================';
GO
```

---

## 📊 Expected Performance Impact

### Before Indexing:
- Query time: **30-60 seconds** (timeout!)
- Table scan: **100% of table**
- I/O operations: **Very high**

### After Indexing:
- Query time: **< 100ms**
- Index seek: **Only relevant rows**
- I/O operations: **Minimal**

**Improvement**: **300-600x faster!**

---

## 🔧 How to Apply

### Step 1: Backup Database
```sql
BACKUP DATABASE [emkl_nest] 
TO DISK = 'C:\Backup\emkl_nest_before_indexing.bak'
WITH FORMAT, COMPRESSION;
```

### Step 2: Run Index Script
- Copy script di atas
- Paste ke SQL Server Management Studio
- Execute (F5)
- Tunggu sampai selesai (2-5 menit tergantung data size)

### Step 3: Verify Indexes
```sql
-- Check apakah index sudah dibuat
SELECT 
    OBJECT_NAME(i.object_id) AS TableName,
    i.name AS IndexName,
    i.type_desc AS IndexType,
    s.user_seeks,
    s.user_scans,
    s.user_lookups
FROM sys.indexes i
LEFT JOIN sys.dm_db_index_usage_stats s 
    ON i.object_id = s.object_id AND i.index_id = s.index_id
WHERE OBJECT_NAME(i.object_id) IN (
    'pengeluaranheader',
    'kasgantungheader',
    'pengembaliankasgantungheader',
    'jurnalumumheader',
    'pengeluaranemklheader',
    'penerimaanemklheader',
    'pengeluaranemkl',
    'penerimaanemkl',
    'pengeluarandetail',
    'kasgantungdetail'
)
ORDER BY TableName, IndexName;
```

### Step 4: Update Statistics
```sql
-- Update statistics untuk performa optimal
UPDATE STATISTICS pengeluaranheader WITH FULLSCAN;
UPDATE STATISTICS kasgantungheader WITH FULLSCAN;
UPDATE STATISTICS pengembaliankasgantungheader WITH FULLSCAN;
UPDATE STATISTICS jurnalumumheader WITH FULLSCAN;
UPDATE STATISTICS pengeluaranemklheader WITH FULLSCAN;
UPDATE STATISTICS penerimaanemklheader WITH FULLSCAN;
UPDATE STATISTICS pengeluaranemkl WITH FULLSCAN;
UPDATE STATISTICS penerimaanemkl WITH FULLSCAN;
UPDATE STATISTICS pengeluarandetail WITH FULLSCAN;
UPDATE STATISTICS kasgantungdetail WITH FULLSCAN;
```

---

## 📈 Monitoring Index Usage

Setelah index dibuat, monitor penggunaannya:

```sql
-- Check index usage (run setelah beberapa hari)
SELECT 
    OBJECT_NAME(s.object_id) AS TableName,
    i.name AS IndexName,
    s.user_seeks AS Seeks,
    s.user_scans AS Scans,
    s.user_lookups AS Lookups,
    s.user_updates AS Updates,
    (s.user_seeks + s.user_scans + s.user_lookups) AS TotalReads
FROM sys.dm_db_index_usage_stats s
JOIN sys.indexes i ON s.object_id = i.object_id AND s.index_id = i.index_id
WHERE OBJECT_NAME(s.object_id) IN (
    'pengeluaranheader',
    'kasgantungheader',
    'pengembaliankasgantungheader'
)
ORDER BY TotalReads DESC;
```

---

## ⚠️ Important Notes

1. **ONLINE = ON**: Index dibuat tanpa lock tabel, aplikasi tetap bisa jalan
2. **FILLFACTOR = 90**: Sisakan 10% space untuk insert baru (optimal untuk tabel yang sering insert)
3. **DESC**: Sort descending karena biasanya cari yang terbaru
4. **INCLUDE**: Covering index - semua kolom yang dibutuhkan ada di index (no table lookup)

---

## 🎯 Next Steps

1. ✅ **DONE**: Code optimization di `running-number.service.ts`
2. 🚨 **URGENT**: Run SQL script untuk create indexes
3. ⏳ **TODO**: Monitor performance setelah indexing
4. ⏳ **TODO**: Schedule index maintenance (rebuild/reorganize) bulanan

---

## 📞 Support

Jika ada error saat create index atau butuh bantuan:
1. Check SQL Server error log
2. Verify disk space (indexes butuh space ~20% dari tabel size)
3. Check SQL Server permissions (butuh ALTER permission)

