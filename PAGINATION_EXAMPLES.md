# 🚀 Quick Example: Pagination Logic

## Contoh Nyata Step-by-Step

### Skenario
```
Database memiliki 180 data akun
Items per page: 30
User menambahkan data baru
```

---

## 📍 Example 1: Item Baru di Position 62 (Page 3)

### Input
```typescript
Total items setelah insert: 180
Items per page: 30
Item baru ID: "A123"
Global index item baru: 61 (0-based)
```

### Step 1: Hitung Target Page
```typescript
globalItemIndex = 61
targetPageNumber = Math.floor(61 / 30) + 1 = 3

// Item ada di Page 3
```

### Step 2: Tentukan 5 Pages
```typescript
startPage = 3 - 2 = 1
endPage = 3 + 2 = 5

fetchedPages = [1, 2, 3, 4, 5]
```

### Step 3: Fetch Data
```typescript
// Fetch page 1: items 1-30
// Fetch page 2: items 31-60
// Fetch page 3: items 61-90  ← Item baru ada disini
// Fetch page 4: items 91-120
// Fetch page 5: items 121-150

Total fetchedData: 150 items
```

### Step 4: Create Temp Table
```typescript
Temp table dengan position field (IDENTITY):

position │ id   │ coa  │ nama
─────────┼──────┼──────┼─────
1        │ X001 │ 1000 │ Kas
2        │ X002 │ 1100 │ Bank
...
62       │ A123 │ 5500 │ Beban ← Item baru!
...
150      │ X150 │ 9000 │ Lain
```

### Step 5: Get Position
```typescript
const positionResult = await trx(tempTableName)
  .select('position')
  .where('id', 'A123')
  .first();

itemPosition = 62
```

### Step 6: Calculate Relative Index
```typescript
startingPosition = (1 - 1) × 30 + 1 = 1
relativeIndex = 62 - 1 = 61

// Artinya: Item ada di fetchedData[61]
```

### Result
```typescript
{
  newItem: { id: "A123", coa: "5500", nama: "Beban" },
  targetPageNumber: 3,
  globalItemIndex: 61,
  itemPosition: 62,
  relativeIndex: 61,
  fetchedPages: [1, 2, 3, 4, 5],
  pageRange: {
    startPage: 1,
    endPage: 5,
    totalFetchedPages: 5
  }
}
```

### Verification
```typescript
console.log(fetchedData[61].id); // "A123" ✓
console.log(fetchedData[61].coa); // "5500" ✓
```

---

## 📍 Example 2: Item Baru di Position 162 (Page 6)

### Input
```typescript
Total items: 300
Items per page: 30
Item baru ID: "B456"
Global index: 161
```

### Step 1: Target Page
```typescript
targetPageNumber = Math.floor(161 / 30) + 1 = 6
```

### Step 2: Pages Range
```typescript
startPage = 6 - 2 = 4
endPage = 6 + 2 = 8

fetchedPages = [4, 5, 6, 7, 8]
```

### Step 3: Fetch Data
```typescript
// Page 4: items 91-120   (global position 91-120)
// Page 5: items 121-150  (global position 121-150)
// Page 6: items 151-180  (global position 151-180) ← Item disini!
// Page 7: items 181-210  (global position 181-210)
// Page 8: items 211-240  (global position 211-240)

Total: 150 items
```

### Step 4: Temp Table Position
```typescript
Temp table position field:

position │ id   │ global_pos
─────────┼──────┼───────────
1        │ Y091 │ 91        ← Page 4 start
2        │ Y092 │ 92
...
72       │ B456 │ 162       ← Item baru!
...
150      │ Y240 │ 240       ← Page 8 end
```

### Step 5: Get Position
```typescript
itemPosition = 72 // Position dalam temp table
```

### Step 6: Calculate Index
```typescript
startingPosition = (4 - 1) × 30 + 1 = 91
relativeIndex = 72 - 1 = 71

// Item ada di fetchedData[71]
```

### Result
```typescript
{
  targetPageNumber: 6,
  itemPosition: 72,      // Position dalam 150 items
  relativeIndex: 71,     // Index array (0-based)
  fetchedPages: [4, 5, 6, 7, 8]
}
```

---

## 📍 Example 3: Item di Page 1 (Edge Case)

### Input
```typescript
Total items: 100
Items per page: 30
Item baru di index: 5
```

### Process
```typescript
targetPageNumber = Math.floor(5 / 30) + 1 = 1

// Coba ambil 2 pages sebelum page 1
startPage = 1 - 2 = -1  ❌
// Adjust!
startPage = 1
endPage = min(5, totalPages)
endPage = min(5, 4) = 4

fetchedPages = [1, 2, 3, 4]  // Hanya 4 pages (tidak cukup 5)
```

### Result
```typescript
{
  targetPageNumber: 1,
  itemPosition: 6,
  relativeIndex: 5,
  fetchedPages: [1, 2, 3, 4],  // Hanya 4 pages
  pageRange: {
    startPage: 1,
    endPage: 4,
    totalFetchedPages: 4
  }
}
```

---

## 📍 Example 4: Item di Last Page

### Input
```typescript
Total items: 600
Items per page: 30
Total pages: 20
Item di page: 20
Item index: 585
```

### Process
```typescript
targetPageNumber = 20

startPage = 20 - 2 = 18
endPage = 20 + 2 = 22 ❌
// Adjust!
endPage = 20 (max)
startPage = max(1, 20 - 5 + 1) = 16

fetchedPages = [16, 17, 18, 19, 20]
```

### Calculation
```typescript
// Page 16 starts at: (16-1) × 30 + 1 = 451
startingPosition = 451

// Item at global index 585
// In temp table position = 586 (1-based)
// But only 150 items in temp table

// Relative to 150 items:
// Item 586 - starting 451 = 135

itemPosition = 136 (dalam 150 items temp table)
relativeIndex = 135 (0-based)
```

### Result
```typescript
{
  targetPageNumber: 20,
  itemPosition: 136,
  relativeIndex: 135,
  fetchedPages: [16, 17, 18, 19, 20]
}

// fetchedData[135].id === newItem.id ✓
```

---

## 🎨 Visual Examples

### Example 1: Middle Page
```
Total: 180 items, 30 per page

┌──────┬──────┬──────┬──────┬──────┬──────┐
│ P1   │ P2   │ P3   │ P4   │ P5   │ P6   │
│ 1-30 │31-60 │61-90 │91-120│121-150│151-180│
└──────┴──────┴──────┴──────┴──────┴──────┘
                 ↑
              New item at position 62

Fetch 5 pages:
┌──────┬──────┬──────┬──────┬──────┐
│ P1   │ P2   │ P3   │ P4   │ P5   │
│ 1-30 │31-60 │61-90 │91-120│121-150│
└──────┴──────┴──────┴──────┴──────┘
                 ↑ position 62
                 
Temp table (150 items):
position: 1, 2, 3, ..., 62, ..., 150
                         ↑ New item
                         
relativeIndex = 62 - 1 = 61
fetchedData[61] === newItem ✓
```

### Example 2: Page 6
```
Total: 300 items, 30 per page

┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐
│P1 │P2 │P3 │P4 │P5 │P6 │P7 │P8 │P9 │P10│
└───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘
              ↑           ↑
         Skip these    Target page 6

Fetch 5 pages: [4, 5, 6, 7, 8]
┌───┬───┬───┬───┬───┐
│P4 │P5 │P6 │P7 │P8 │
│91 │121│151│181│211│
└───┴───┴───┴───┴───┘
          ↑ position 162

Temp table (150 items):
position 1 = global 91
position 72 = global 162 ← New item
position 150 = global 240

relativeIndex = 72 - 1 = 71
fetchedData[71] === newItem ✓
```

---

## 📊 Formula Summary

```typescript
// Given:
const itemsPerPage = 30;
const globalItemIndex = 161; // 0-based
const newItemId = "ABC123";

// Calculate:
const targetPageNumber = Math.floor(globalItemIndex / itemsPerPage) + 1;
// = Math.floor(161 / 30) + 1 = 6

const startPage = Math.max(1, targetPageNumber - 2);
// = Math.max(1, 6 - 2) = 4

const endPage = Math.min(totalPages, targetPageNumber + 2);
// = Math.min(10, 6 + 2) = 8

// Fetch pages [4, 5, 6, 7, 8] = 150 items

const startingPosition = (startPage - 1) * itemsPerPage + 1;
// = (4 - 1) * 30 + 1 = 91

// Query temp table:
const itemPosition = await getPositionFromTempTable(newItemId);
// = 72 (1-based position dalam 150 items)

const relativeIndex = itemPosition - 1;
// = 72 - 1 = 71 (0-based)

// Verify:
fetchedData[relativeIndex].id === newItemId; // ✓
```

---

## 🧪 Quick Test

```typescript
function testPagination() {
  const scenarios = [
    { total: 180, perPage: 30, itemIndex: 61, expected: { page: 3, relIndex: 61 } },
    { total: 300, perPage: 30, itemIndex: 161, expected: { page: 6, relIndex: 71 } },
    { total: 100, perPage: 30, itemIndex: 5, expected: { page: 1, relIndex: 5 } },
    { total: 600, perPage: 30, itemIndex: 585, expected: { page: 20, relIndex: 135 } },
  ];

  scenarios.forEach((test, i) => {
    const page = Math.floor(test.itemIndex / test.perPage) + 1;
    const startPage = Math.max(1, page - 2);
    const startPos = (startPage - 1) * test.perPage;
    const relIndex = test.itemIndex - startPos;
    
    console.log(`Test ${i + 1}:`);
    console.log(`  Target page: ${page} (expected: ${test.expected.page}) ${page === test.expected.page ? '✓' : '✗'}`);
    console.log(`  Relative index: ${relIndex} (expected: ${test.expected.relIndex}) ${relIndex === test.expected.relIndex ? '✓' : '✗'}`);
  });
}

testPagination();
```

---

**Dengan implementasi ini, sistem dapat handle berbagai skenario pagination dengan akurat dan efisien!** 🎯
