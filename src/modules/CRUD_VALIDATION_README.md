# Global CRUD Modules Validation Test

## 📋 Overview

Sistem testing global untuk memvalidasi konsistensi dan best practices di semua CRUD modules dalam aplikasi. Test ini secara otomatis menscan semua module di folder `src/modules` dan memvalidasi:

- ✅ Struktur file yang konsisten
- ✅ Method CRUD yang wajib ada
- ✅ HTTP endpoints yang lengkap
- ✅ Decorator NestJS yang proper
- ✅ Error handling patterns
- ✅ Dependency injection
- ✅ Best practices

## 🚀 Cara Menggunakan

### Menjalankan Test

```bash
# Run all tests including global validation
npm test

# Run only global validation test
npm test -- crud-modules.global.spec.ts

# Run with verbose output
npm test -- crud-modules.global.spec.ts --verbose

# Run with coverage
npm run test:cov -- crud-modules.global.spec.ts
```

### Menjalankan dalam Watch Mode

```bash
npm test -- crud-modules.global.spec.ts --watch
```

### Melihat Log File

Setelah test selesai, log file akan tersimpan di:
```bash
test-logs/crud-validation.log
```

**Cara membuka log:**

Windows:
```bash
# Buka dengan notepad
notepad test-logs\crud-validation.log

# Atau dengan default text editor
start test-logs\crud-validation.log

# Atau dengan cat (jika ada Git Bash)
cat test-logs/crud-validation.log
```

Linux/Mac:
```bash
# Buka dengan cat
cat test-logs/crud-validation.log

# Atau dengan less untuk scroll
less test-logs/crud-validation.log

# Atau dengan default editor
nano test-logs/crud-validation.log
```

**Filter log untuk error saja:**
```bash
# Windows (PowerShell)
Get-Content test-logs\crud-validation.log | Select-String "ERROR"

# Linux/Mac
grep "ERROR" test-logs/crud-validation.log
```

## 📝 Log Files

Setiap kali test dijalankan, hasil test akan disimpan ke file log di:
```
test-logs/crud-validation.log
```

**Fitur Log File:**
- ✅ **Auto-delete**: File log lama dihapus otomatis sebelum membuat yang baru
- ✅ **Detailed logging**: Semua hasil validasi dicatat dengan timestamp
- ✅ **Categorized**: Pass/Fail/Warning dengan emoji indicators
- ✅ **Summary statistics**: Total modules, validations, success rate, duration
- ✅ **Failure grouping**: Modules dengan failures dikelompokkan untuk mudah review

**Contoh Isi Log File:**
```
================================================================================
CRUD MODULES VALIDATION TEST LOG
Started: 2025-11-26T10:30:15.123Z
================================================================================

[2025-11-26T10:30:15.150Z] ℹ️ INFO: Found 85 modules to validate

--------------------------------------------------------------------------------
MODULE STRUCTURE VALIDATION
--------------------------------------------------------------------------------

[2025-11-26T10:30:15.180Z] ✅ SUCCESS: All modules have service files
[2025-11-26T10:30:15.185Z] ✅ SUCCESS: All modules have module files

--------------------------------------------------------------------------------
SERVICE FILES VALIDATION
--------------------------------------------------------------------------------

[2025-11-26T10:30:15.200Z] ✅ SUCCESS: [kapal] [service] All required methods are present
[2025-11-26T10:30:15.205Z] ❌ ERROR: [container] [service] Missing required methods: delete
  Details: {"missingMethods": ["delete"], "foundMethods": ["create", "findAll", "update"]}

================================================================================
VALIDATION SUMMARY
================================================================================
Total Modules Scanned: 85
Total Validations Run: 340
✅ Passed: 320
❌ Failed: 5
⚠️  Warnings: 15
Success Rate: 94%
================================================================================

Completed: 2025-11-26T10:30:25.456Z
Duration: 10.33 seconds

Log file saved at: /path/to/project/test-logs/crud-validation.log
```

## 📊 Output yang Dihasilkan

Test akan menghasilkan report yang mencakup:

1. **Module Structure Validation**
   - Jumlah module yang di-scan
   - Module tanpa service file
   - Module tanpa module file

2. **Service Files Validation**
   - Required methods: `create`, `findAll`, `update`, `delete`
   - Optional methods: `getById`, `exportToExcel`, dll
   - Best practices: error handling, tableName property, constructor

3. **Controller Files Validation**
   - HTTP endpoints: POST, GET, PUT/PATCH, DELETE
   - Decorators: @Controller, @UseGuards
   - Dependency injection

4. **Module Files Validation**
   - @Module decorator
   - Providers array
   - Controllers array
   - Exports array

5. **Overall Statistics**
   - Total modules scanned
   - Passed/Failed/Warnings count
   - Modules dengan failures

### Contoh Output

```
📦 Found 85 modules to validate

  Global CRUD Modules Validation
    Module Structure Validation
      ✓ should have at least one module to validate
      ✓ should have service file in each module
      ✓ should have module file in each module
    Service Files Validation
      kapal Service
        ✓ should have valid service structure
        ✓ should have all required CRUD methods
        ✓ should follow best practices
      akunpusat Service
        ✓ should have valid service structure
        ✓ should have all required CRUD methods
        ✓ should follow best practices
    ...

============================================================
📊 VALIDATION SUMMARY
============================================================
Total Modules Scanned: 85
Total Validations Run: 340
✅ Passed: 320
❌ Failed: 5
⚠️  Warnings: 15
============================================================
```

## ⚙️ Konfigurasi

### Mengubah Module yang Di-skip

Edit file `crud-modules.global.spec.ts`:

```typescript
const SKIP_MODULES = [
  'auth',
  'bot',
  'your-custom-module',
];
```

### Mengubah Required Methods

Edit array `REQUIRED_SERVICE_METHODS`:

```typescript
const REQUIRED_SERVICE_METHODS = [
  'create',
  'findAll',
  'update',
  'delete',
  'customMethod', // tambahkan custom method
];
```

### Custom Rules per Module

Edit file `crud-validation.config.ts`:

```typescript
export const moduleSpecificRules: Record<string, Partial<CrudValidationConfig>> = {
  'your-module': {
    requiredServiceMethods: ['create', 'findAll', 'customMethod'],
  },
};
```

## 🎯 Best Practices yang Divalidasi

### Service File
- ✅ Memiliki `@Injectable()` decorator
- ✅ Memiliki constructor untuk dependency injection
- ✅ Memiliki property `tableName`
- ✅ Semua method menggunakan try-catch
- ✅ Method CRUD lengkap: `create`, `findAll`, `update`, `delete`

### Controller File
- ✅ Memiliki `@Controller()` decorator
- ✅ HTTP endpoints lengkap: `@Post`, `@Get`, `@Put/@Patch`, `@Delete`
- ✅ Menggunakan `@UseGuards()` untuk security
- ✅ Constructor inject service

### Module File
- ✅ Memiliki `@Module()` decorator
- ✅ Mendefinisikan `providers` array
- ✅ Mendefinisikan `controllers` array
- ✅ Mempertimbangkan `exports` array untuk shared services

## 🔧 Troubleshooting

### Test Gagal - "Missing required methods"

**Problem:** Module tidak memiliki semua CRUD methods yang required.

**Solution:**
1. Implementasikan method yang hilang di service file
2. Atau tambahkan module ke `SKIP_MODULES` jika memang bukan CRUD module
3. Atau buat custom rule di `moduleSpecificRules`

### Test Gagal - "Controller must have @Controller() decorator"

**Problem:** Controller file tidak memiliki decorator yang proper.

**Solution:**
```typescript
@Controller('your-endpoint')
export class YourController {
  // ...
}
```

### Warning - "Service should have a tableName property"

**Problem:** Service tidak mendefinisikan tableName.

**Solution:**
```typescript
@Injectable()
export class YourService {
  private readonly tableName = 'your_table';
  // ...
}
```

### Warning - "Controller should use guards"

**Problem:** Controller tidak menggunakan authentication/authorization guards.

**Solution:**
```typescript
@Controller('your-endpoint')
@UseGuards(JwtAuthGuard)
export class YourController {
  // ...
}
```

## 📝 Response Structure Standards

### Create Response
```typescript
{
  newItem: {...},
  pageNumber: number,
  itemIndex: number,
  fetchedPages: number[]
}
```

### FindAll Response
```typescript
{
  data: any[],
  pagination: {
    currentPage: number,
    totalPages: number,
    totalItems: number,
    itemsPerPage: number
  },
  total: number
}
```

### Update Response
```typescript
{
  updatedItem: {...},
  pageNumber: number,
  itemIndex: number,
  fetchedPages: number[]
}
```

### Delete Response
```typescript
{
  status: number,
  message: string,
  deletedData: {...}
}
```

## 🤝 Contributing

Jika ingin menambahkan validasi baru:

1. Edit `validateServiceFile()` atau `validateControllerFile()`
2. Tambahkan test case baru di test suite
3. Update dokumentasi ini
4. Run test untuk memastikan tidak break existing tests

## 📚 References

- [NestJS Testing Documentation](https://docs.nestjs.com/fundamentals/testing)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [TypeScript Best Practices](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)

## 🐛 Issues

Jika menemukan bug atau ingin request feature:
1. Buat issue di repository
2. Jelaskan expected behavior vs actual behavior
3. Sertakan module yang bermasalah
4. Sertakan output test yang error
