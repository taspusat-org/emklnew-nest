# Panduan Penggunaan Temporary Table Utility

## Overview
Utility method `createTempTableFromData()` memudahkan pembuatan temporary table dari data array tanpa perlu mendefinisikan struktur kolom secara manual.

## Keuntungan

✅ **Auto-detect struktur** - Otomatis mendeteksi tipe data dari object pertama  
✅ **Batch insert** - Insert data dalam chunks (1000 rows per batch) untuk performa optimal  
✅ **Reusable** - Dapat digunakan di semua service tanpa duplikasi kode  
✅ **Type-safe** - Mendukung integer, decimal, boolean, datetime, string, dan text  
✅ **Clean code** - Tidak perlu menulis manual column definition

## Cara Penggunaan

### 1. Basic Usage

```typescript
// Di dalam service method dengan transaction
const { tempTableName, insertedCount } = await this.utilsService.createTempTableFromData(
  dataArray,      // Array of objects
  trx,            // Transaction object
  'custom_prefix' // Optional: custom prefix untuk nama table
);

console.log(`Created ${tempTableName} with ${insertedCount} rows`);
```

### 2. Contoh di Create Method

```typescript
async create(createDto: any, trx: any) {
  // ... existing code ...
  
  const fetchedData = []; // Data dari findAll()
  
  // Create temp table from fetched data
  const { tempTableName, insertedCount } = 
    await this.utilsService.createTempTableFromData(
      fetchedData,
      trx,
      this.tableName, // Prefix dengan nama table
    );
  
  // Gunakan tempTableName untuk query selanjutnya
  const result = await trx(tempTableName)
    .where('id', someId)
    .first();
  
  return {
    newItem,
    tempTableName,
    insertedCount
  };
}
```

### 3. Contoh di Update Method

```typescript
async update(data: any, trx: any) {
  // ... existing code ...
  
  const { data: filteredData } = await this.findAll({...}, trx);
  
  // Create temp table
  const { tempTableName } = await this.utilsService.createTempTableFromData(
    filteredData,
    trx,
    `${this.tableName}_update`
  );
  
  // Query dengan temp table
  const updatedData = await trx(tempTableName)
    .select('*')
    .where('status', 'active');
  
  return { updatedItem, tempTableName };
}
```

### 4. Dengan Custom Data Structure

```typescript
// Data dengan berbagai tipe
const customData = [
  {
    id: 1,
    name: 'John Doe',
    age: 30,
    salary: 5000000.50,
    isActive: true,
    joinDate: new Date('2024-01-15'),
    notes: 'Lorem ipsum dolor sit amet...' // String panjang akan jadi TEXT
  },
  // ... more rows
];

const { tempTableName } = await this.utilsService.createTempTableFromData(
  customData,
  trx,
  'employee'
);

// Result: ##temp_employee_abc123xyz
```

## Tipe Data Mapping

| JavaScript Type | SQL Column Type | Note |
|----------------|----------------|------|
| `number` (integer) | `INTEGER` | Untuk bilangan bulat |
| `number` (float) | `DECIMAL(18,2)` | Untuk desimal |
| `boolean` | `BOOLEAN` | true/false |
| `Date` | `DATETIME` | Date objects |
| `string` (≤500 char) | `VARCHAR(255)` | String pendek |
| `string` (>500 char) | `TEXT` | String panjang |
| `null/undefined` | `VARCHAR(255)` | Default fallback |

## Best Practices

### 1. Gunakan Transaction
```typescript
// ✅ CORRECT
await trx.transaction(async (trx) => {
  const { tempTableName } = await this.utilsService.createTempTableFromData(data, trx);
  // ... use tempTableName
});

// ❌ WRONG - tanpa transaction
const { tempTableName } = await this.utilsService.createTempTableFromData(data);
```

### 2. Custom Prefix untuk Identifikasi
```typescript
// ✅ CORRECT - mudah di-track
await this.utilsService.createTempTableFromData(data, trx, 'akunpusat_create');
await this.utilsService.createTempTableFromData(data, trx, 'container_update');

// ❌ WRONG - sulit di-track
await this.utilsService.createTempTableFromData(data, trx);
```

### 3. Pastikan Data Tidak Kosong
```typescript
// ✅ CORRECT
if (fetchedData.length > 0) {
  const { tempTableName } = await this.utilsService.createTempTableFromData(
    fetchedData, 
    trx, 
    this.tableName
  );
}

// ❌ WRONG - bisa error jika data kosong
const { tempTableName } = await this.utilsService.createTempTableFromData(
  fetchedData, 
  trx
);
```

### 4. Batch Processing untuk Data Besar
```typescript
// Method sudah otomatis handle batch (1000 rows per chunk)
// Tidak perlu manual batching
const largeData = Array(50000).fill({...}); // 50k rows

const { insertedCount } = await this.utilsService.createTempTableFromData(
  largeData,
  trx,
  'large_dataset'
);

console.log(`Successfully inserted ${insertedCount} rows in batches`);
```

## Error Handling

```typescript
try {
  const { tempTableName, insertedCount } = 
    await this.utilsService.createTempTableFromData(data, trx, 'prefix');
  
  console.log(`Created: ${tempTableName} with ${insertedCount} rows`);
  
} catch (error) {
  if (error.message.includes('Data array is empty')) {
    // Handle empty data
  } else if (error.message.includes('Failed to create temp table')) {
    // Handle creation error
  }
  throw error;
}
```

## Migration Guide

### Dari Cara Lama ❌
```typescript
const temp = `##temp_${Math.random().toString(36).substring(2, 15)}`;
await trx.schema.createTable(temp, (t) => {
  t.integer('nomor');
  t.string('id');
  t.string('type_id');
  t.string('level');
  t.string('coa');
  t.string('keterangancoa');
  t.string('statusaktif');
  t.string('statusaktif_nama');
  t.string('memo');
  t.string('parent');
  t.string('cabang_id');
  t.string('cabang_nama');
  t.string('type_nama');
  t.string('info');
  t.string('modifiedby');
  t.string('created_at');
  t.string('updated_at');
  t.string('__total_items');
});
await trx(temp).insert(fetchedData);
```

### Ke Cara Baru ✅
```typescript
const { tempTableName, insertedCount } = 
  await this.utilsService.createTempTableFromData(
    fetchedData,
    trx,
    this.tableName
  );

// Lebih singkat, lebih maintainable, reusable!
```

## Performance Tips

1. **Chunk Size**: Default 1000 rows per batch, optimal untuk kebanyakan kasus
2. **Index**: Jika perlu query kompleks, pertimbangkan create index setelah insert
3. **Memory**: Temp table otomatis di-drop saat transaction selesai
4. **Concurrency**: Setiap transaction dapat unique temp table name

## Contoh Lengkap di Service

```typescript
import { UtilsService } from 'src/utils/utils.service';

@Injectable()
export class ExampleService {
  constructor(
    private readonly utilsService: UtilsService,
  ) {}

  async create(createDto: any, trx: any) {
    try {
      // Insert new item
      const newItem = await trx(this.tableName)
        .insert(insertData)
        .returning('*');

      // Fetch related data
      const { data: allData } = await this.findAll({...}, trx);

      // Create temp table dari hasil findAll
      const { tempTableName, insertedCount } = 
        await this.utilsService.createTempTableFromData(
          allData,
          trx,
          `${this.tableName}_create`
        );

      // Gunakan temp table untuk query
      const analysis = await trx(tempTableName)
        .select('*')
        .where('status', 'active')
        .orderBy('created_at', 'desc');

      return {
        newItem,
        tempTableName,
        insertedCount,
        analysis
      };
    } catch (error) {
      throw new Error(`Error creating: ${error.message}`);
    }
  }
}
```

## Notes

- Temp table otomatis di-drop ketika transaction selesai
- Nama table selalu dimulai dengan `##temp_` (SQL Server global temp table)
- Mendukung semua tipe data JavaScript standar
- Optimal untuk data hingga ratusan ribu baris

## Support

Jika ada issue atau pertanyaan, contact: Development Team
