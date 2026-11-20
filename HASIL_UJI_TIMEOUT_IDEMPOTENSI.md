# Hasil Uji Timeout & Idempotensi — 20 Agustus 2026

Eksekusi otomatis atas skenario di [TIMEOUT_TEST_PLAN.md](TIMEOUT_TEST_PLAN.md), dijalankan
langsung terhadap backend + PostgreSQL + Redis lokal. Tanpa dependency tambahan (klien uji
memakai modul `http` bawaan Node) dan tanpa mengubah satu baris pun kode aplikasi.

## Cara pengujian

| Instance | Port | `REQUEST_TIMEOUT_MS` | Preset | Dipakai untuk |
| --- | --- | --- | --- | --- |
| dev server milik user | 5004 | 120000 | B | S1–S10 (FE yang menyerah duluan) |
| instance uji | 5005 | 10000 | A | T06–T13, TX1 |
| instance uji | 5006 | *(kosong → 30000)* | C | T11 |

Kedua instance uji dijalankan dari `dist/` hasil `npm run build`, lalu dimatikan setelah
selesai. `.env` tidak diubah — preset diberikan lewat variabel environment saat start.
Klien uji meniru perilaku axios: `abortAfterMs` = titik browser menyerah.

---

## 1. Ringkasan

**18 skenario lulus, 6 temuan.** Mesin timeout dan mesin idempotensi keduanya bekerja
sesuai desain. Yang bocor ada di sekitarnya: satu endpoint tanpa autentikasi, satu janji
yang tidak selalu benar, satu bug hapus, dan cakupan idempotensi yang baru 1 dari 111 modul.

> **Status per 20-08-2026: T-2 sudah diperbaiki dan diverifikasi ulang** (lihat bagian
> tersebut). Lima temuan lain masih terbuka.

### Yang sudah benar

| No | Skenario | Hasil |
| --- | --- | --- |
| S1 | Simpan ulang **selagi request pertama masih jalan** | 1 baris. req2 blok di unique index, lalu me-replay hasil req1 |
| S2 | Replay sesudah request pertama commit | 201/7 ms, `id` identik |
| S3 | Kunci sama untuk payload berbeda | 409, data kedua tidak masuk |
| S4 | Klik dobel serentak | 1 baris, dua-duanya 201, tidak ada 500 |
| S5 | Tanpa header `Idempotency-Key` | jalan normal, modul lain tidak terpengaruh |
| S6 | Dua user, nilai kunci identik | terisolasi per `modifiedby` |
| S8 | UPDATE diulang dengan kunci sama | replay, `updated_at` tidak berubah |
| S9 | Kunci > 200 karakter | 400 sebelum menulis apa pun |
| S10 | Kunci dikirim di GET | diabaikan, tidak disimpan |
| T06 | BE timeout saat CREATE | 408 @10.02 s, **rollback penuh**: 0 baris users, 0 logtrail, 0 kunci |
| T06b | Simpan ulang sesudah 408 | benar-benar menyimpan (kunci ikut ter-rollback) |
| T08 | BE timeout saat DELETE | 408, baris masih ada, logtrail tidak bertambah |
| T09 | BE timeout saat GET | 408 @10.02 s |
| T11 | Balapan produksi BE 30 s vs FE 35 s | **server menang 3/3**, 0 baris tertinggal |
| T12 | 35 request lambat vs pool 30 | semua 408, user biasa 4/4 berhasil, pulih < 3 s |
| T13 | Cetak & export saat timeout ketat | balas 6 ms, job selesai, file tetap terunduh |

Yang paling penting: **T06 membuktikan rollback-nya utuh** — data, jejak audit, dan kunci
idempotensi hilang bersamaan, sehingga simpan ulang sesudah 408 memang menyimpan dan bukan
me-replay respons kosong. Dan **S1 membuktikan jendela paling berbahaya sudah tertutup**:
saat user menekan SIMPAN lagi sementara request pertama belum commit, request kedua tidak
membuat baris kedua — ia menunggu di unique index `(key, modifiedby)` lalu membalas hasil
pemenang.

---

## 2. Temuan

### T-1 · Endpoint Redis terbuka tanpa autentikasi — **prioritas tertinggi**

[redis.controller.ts](src/common/redis/redis.controller.ts) tidak punya `@UseGuards(AuthGuard)`
sama sekali. Terverifikasi tanpa token apa pun:

```bash
curl -s http://localhost:5005/redis/get/users-page-1
```

Balasannya isi cache grid user lengkap — `id`, `username`, `email`, `statusaktif`,
`modifiedby`. Tiga masalah sekaligus:

1. `GET /redis/get/:key` membocorkan isi cache ke siapa pun yang bisa menjangkau API.
2. `RedisService.get()` **menghapus key sesudah dibaca**, jadi endpoint ini juga destruktif —
   pemanggil anonim bisa menguras cache.
3. `POST /redis/set` dan `POST /redis/del` sama-sama terbuka: cache bisa ditulisi dan
   dihapus dari luar.

Ini melanggar aturan #5 di `CLAUDE.md` ("guard every endpoint"). Ditemukan saat menelusuri
T10 — bukan bagian dari desain timeout, tapi justru yang membuat sisa cache pasca-rollback
bisa dibaca orang luar.

**Perbaikan:** pasang `AuthGuard` (dan idealnya `AclGuard`) di ketiga route, atau cabut
controllernya kalau memang hanya alat debug.

---

### T-2 · 408 tidak selalu berarti "data tidak tersimpan" — ✅ SUDAH DIPERBAIKI

Seluruh desain FE bertumpu pada satu janji: *408 = server membatalkan sendiri = transaksi
sudah rollback = data pasti tidak tersimpan.* Janji itu **tidak absolut**.

Terbukti di TX1 (preset A) dan diulang di T11b pada **konfigurasi produksi** (preset C):

```
status=408 setelah 30.018 ms
pesan ke user  : "DATA TIDAK TERSIMPAN, SILAKAN COBA LAGI"
kenyataan di DB: 1 baris  ← tersimpan
```

Penyebabnya: timer timeout menutup seluruh observable, termasuk celah **sesudah**
`trx.commit()` berhasil. Saat timer menyala di celah itu, `rollbackActiveTransactions()`
menemukan transaksi yang sudah `isCompleted()` sehingga rollback dilewati — tapi 408 tetap
dikirim. Log backend memperlihatkannya dengan jelas: baris `rolling back 1 transaction(s)`
muncul **tanpa** diikuti `Transaction auto-rolled back via abort signal`.

Token `LABAFTER` melebarkan celah itu supaya bisa diamati; di kode produksi celahnya selebar
durasi `trx.commit()` itu sendiri — sempit, tapi nyata, dan pasti kena pada request yang
commit-nya jatuh persis di detik ke-30.

Dua hal memperparah:

- **FE sengaja tidak refetch pada 408.** [AxiosInstance.ts:490](../emklnew-next/lib/utils/AxiosInstance.ts#L490):
  `if (!serverTimedOut) void queryClient.invalidateQueries();`. Jadi tepat pada kasus di mana
  pesannya salah, grid juga tidak ditarik ulang — user tidak punya cara melihat kenyataannya.
- **504 tidak punya jaminan itu sama sekali.** Blok yang sama memperlakukan 504 seperti 408.
  408 memang datang dari `TimeoutInterceptor`, tapi 504 datang dari nginx/proxy di depan
  aplikasi, yang tidak tahu apa-apa soal transaksi. Untuk 504, "DATA TIDAK TERSIMPAN" adalah
  tebakan yang dinyatakan sebagai kepastian.

#### Perbaikan yang diterapkan

**Backend — 408 sekarang benar-benar sebuah jaminan.**

- [request-context.ts](src/common/context/request-context.ts) — `RequestStore` mendapat
  flag `commitAttempted`.
- [db.ts](src/common/utils/db.ts) — flag dinyalakan di pembungkus `commit`, **sebelum**
  `COMMIT` dikirim ke Postgres, bukan sesudah. Begitu perintah itu berangkat kita tidak lagi
  tahu apakah ia sempat mendarat, jadi sejak detik itu request tidak boleh dijawab 408.
- [timeout.interceptor.ts](src/common/interceptors/timeout.interceptor.ts) — bila
  `commitAttempted` menyala saat timer berbunyi, 408 **tidak dikirim**. Timer dilepas dan
  handler dibiarkan menyelesaikan balasannya sendiri. Sinyal abort sengaja tidak dinyalakan
  di cabang ini supaya sisa kode setelah commit tidak berubah menjadi error palsu; transaksi
  lain yang masih terbuka tetap dilepas agar koneksi pool bebas.

**Frontend — 504 dipisahkan dari 408, dan refetch dikembalikan.**

- [AxiosInstance.ts](../emklnew-next/lib/utils/AxiosInstance.ts) — `serverTimedOut` dipecah
  jadi `backendTimedOut` (408) dan `gatewayTimedOut` (504). Hanya 408 yang berhak memakai
  pesan "DATA TIDAK TERSIMPAN"; 504 kini memakai pesan "DATA MUNGKIN SUDAH TERSIMPAN" yang
  sama dengan jalur ECONNABORTED, karena proxy tidak tahu apa-apa soal transaksi.
- `if (!serverTimedOut)` dihapus dari pemanggilan `queryClient.invalidateQueries()` —
  sekarang **semua** jenis timeout memicu refetch. Biayanya satu GET; untungnya user selalu
  punya cara melihat kondisi sebenarnya.

#### Hasil verifikasi ulang

| Uji | Sebelum | Sesudah |
| --- | --- | --- |
| Preset A, timeout sesudah commit (`LABAFTER20`) | 408 @10 s, "DATA TIDAK TERSIMPAN", 1 baris di DB | **201 @20,2 s**, 1 baris di DB — pesan cocok dengan kenyataan |
| Preset C (produksi), timeout sesudah commit (`LABAFTER40`) | 408 @30 s, "DATA TIDAK TERSIMPAN", 1 baris di DB | **browser menyerah @35 s** → "DATA MUNGKIN SUDAH TERSIMPAN" + refetch |

Log backend mengonfirmasi jalur barunya menyala di kedua preset:

```
[TIMEOUT] Batas 10000ms terlampaui, tetapi transaksi sudah masuk tahap commit
          — 408 tidak dikirim karena datanya mungkin sudah tersimpan
[TIMEOUT] Batas 30000ms terlampaui, tetapi transaksi sudah masuk tahap commit
          — 408 tidak dikirim karena datanya mungkin sudah tersimpan
```

Uji regresi — jalur rollback tidak berubah sedikit pun:

| Regresi | Hasil |
| --- | --- |
| Timeout **sebelum** commit (CREATE) | 408 @10,0 s, 0 baris, logtrail tidak bertambah |
| Timeout GET | 408 @10,0 s |
| Timeout DELETE | 408 @10,0 s, baris tetap ada |
| Simpan normal tanpa token lab | 201 @83 ms |

Tidak ada unhandled rejection, `already complete`, atau `Failed to rollback` di log.

---

### T-3 · DELETE data yang tidak ada membalas 200 dan menulis jejak audit palsu

[utils.service.ts:518](src/utils/utils.service.ts#L518) — `lockAndDestroy` mengembalikan
`true` (boolean) ketika barisnya tidak ditemukan. Nilai itu diteruskan sebagai `deletedData`:

```ts
const deletedData = await this.utilsService.lockAndDestroy(id, ...); // === true
await this.logTrailService.create({ idtrans: deletedData.id, ... }, trx); // undefined
```

Terverifikasi — tiga request DELETE, hanya satu yang benar-benar menghapus, tapi
**logtrail bertambah 3**:

```
hapus#1 (baris ada)         : 200  deletedData = object
hapus#2 (baris sudah hilang): 200  deletedData = true
hapus#3 (id ngawur)         : 200  deletedData = true
logtrail users bertambah    : 3

idtrans=null  nobukti=""  datajson=true     ← sampah
idtrans=null  nobukti=""  datajson=true     ← sampah
idtrans="02-01A01DFB-…"    datajson={"username":"S7BUSER",…}
```

Akibatnya:

- Cabang `if (result.status === 404)` di [user.controller.ts:200](src/modules/user/user.controller.ts#L200)
  **dead code** — service tidak pernah mengembalikan 404.
- Komentar di atas `idempotencyService.save()` pada jalur delete ("tanpa kunci ini, hapus
  yang diulang setelah timeout menjawab 404") memakai premis yang keliru. Yang terjadi 200,
  bukan 404. Kunci idempotensi di DELETE karena itu menutupi gejala, bukan menyelesaikan
  sebabnya.
- Jejak audit tercemar baris tanpa `idtrans`.

Catatan terpisah dari baris `datajson` di atas: **hash password ikut tertulis ke logtrail**
saat user dihapus. Sebaiknya dibuang dari payload jejak audit.

> Sisa pengujian: ada **3 baris logtrail `idtrans=null`** di database uji (07:02–07:03 UTC
> 20-08-2026). Saya tidak menghapusnya — penghapusan baris audit sebaiknya keputusan Anda.

---

### T-4 · Idempotensi baru terpasang di 1 dari 111 controller mutasi

```
controller yang memakai IdempotencyInterceptor : 1   (user)
controller dengan endpoint POST/PUT/DELETE     : 111
```

Ironisnya `user` adalah modul yang **paling tidak membutuhkannya**. Terbukti di TX2: sesudah
408 palsu, user menutup lalu membuka modal (kunci baru), mengetik ulang data yang sama —
tidak lahir baris kedua, karena `CreateUserSchema` sudah memblokir username duplikat lewat
`isRecordExistCI`. Jadi yang menyelamatkan di modul user adalah **keunikan username**, bukan
idempotensi.

Modul transaksi — jurnalumum, kasgantung, hutangheader, biayaheader — tidak punya kunci
alami semacam itu. Di sanalah simpan-ulang sesudah timeout benar-benar melahirkan dokumen
dobel, dan di sanalah `IdempotencyInterceptor` belum dipasang.

**Saran:** prioritaskan pemasangan ke modul header/detail transaksi, bukan ke master data.

---

### T-5 · Simpan ulang bisa ikut kena timeout

Dari S1, dengan tahanan 20 detik:

```
req1 dikirim, klien menyerah di 12.070 ms
req2 dikirim di detik 13  →  201 setelah 20.347 ms
```

req2 tidak langsung dibalas: ia menunggu di unique index `(key, modifiedby)` sampai
transaksi req1 commit. Aman untuk data, tapi artinya **lama tunggu req2 ≈ sisa waktu req1**.
Kalau request pertama butuh 60 detik, simpan ulang akan menggantung ~47 detik — melewati
`MUTATION_TIMEOUT_MS` 35 detik di FE, sehingga simpan ulang pun berakhir timeout dan user
mengulang lagi.

TIMEOUT_TEST_PLAN.md menuliskan ekspektasi "request kedua dijawab cepat (tidak menunggu 45
detik lagi)". Itu hanya benar bila kiriman pertama sudah commit. Perlu dikoreksi di dokumen.

**Opsi perbaikan:** tulis baris kunci lebih awal (status "sedang diproses") di transaksi
terpisah, lalu balas 409 "sedang diproses" ke kiriman kedua alih-alih membiarkannya
menggantung.

---

### T-6 · Cache Redis ditulis di dalam transaksi tapi tidak ikut rollback

T10 terkonfirmasi: sesudah 408 dan rollback, `users-page-2` masih memuat `T10USER` yang
**tidak ada** di database.

```
status=408/10.015 ms | baris di DB = 0 | baris hantu di cache = true ["users-page-2"]
```

Dampaknya **kecil untuk saat ini**: tidak ada satu pun kode yang membaca `users-page-N` —
`redisService.set()` di [user.service.ts:279](src/modules/user/user.service.ts#L279) menulis
tanpa pembaca. Jadi hari ini ia hanya menulis sia-sia di dalam transaksi (dan memperpanjang
umur transaksi). Yang membuatnya tetap perlu dicatat: satu-satunya jalan membaca key itu
adalah endpoint di T-1 yang terbuka untuk umum.

---

## 3. Catatan kecil

| Hal | Lokasi | Keterangan |
| --- | --- | --- |
| `rolling back N transaction(s)` selalu melebih-lebihkan | [timeout.interceptor.ts:49](src/common/interceptors/timeout.interceptor.ts#L49) | `activeTransactions` tidak pernah dibersihkan saat commit, jadi transaksi yang sudah selesai ikut terhitung. Membuat log menyesatkan justru pada kasus T-2. |
| `statuscode` selalu dicatat 200 | [idempotency.service.ts:119](src/common/idempotency/idempotency.service.ts#L119) | POST membalas 201, tapi kolomnya menyimpan 200. Kosmetik. |
| Timeout di DELETE diturunkan jadi 500 | [user.service.ts:711](src/modules/user/user.service.ts#L711) | `catch` hanya melanjutkan `NotFoundException`; `RequestTimeoutException` jadi `InternalServerErrorException`. Tertutup karena interceptor sudah mengirim 408 lebih dulu. |
| `replayAfterConflict` menebak semua 23505 sebagai bentrok idempotensi | [idempotency.service.ts:146](src/common/idempotency/idempotency.service.ts#L146) | Unique violation dari constraint lain akan dibalas "Permintaan yang sama sedang diproses" — menyesatkan. Batasi ke constraint `idempotencykey`. |
| Kredensial ter-hardcode | [knexfile.ts:270](src/knexfile.ts#L270) | Blok `mysqltest` memuat host/user/password literal. Melanggar aturan #8 `CLAUDE.md`. |
| CORS tidak mengizinkan PATCH | [main.ts:49](src/main.ts#L49) | `IdempotencyInterceptor` menangani PATCH, tapi CORS belum. Tidak berdampak selama belum ada route PATCH. |

---

## 4. Kondisi database sesudah pengujian

- `users` kembali ke 3 baris semula (`admin`, `it`, `zxczxc`) — 8 baris uji dihapus.
- `idempotencykey` kembali ke 16 baris milik sesi manual sebelumnya — 11 baris uji dihapus.
- `logtrail`: **23 baris `namatabel=users` dari sesi ini masih ada**, 3 di antaranya adalah
  baris `idtrans=null` bukti T-3. Sengaja tidak dihapus.
- Kedua instance uji (5005, 5006) sudah dimatikan; dev server di 5004 tidak disentuh.

## 5. Urutan perbaikan yang disarankan

1. ~~**T-2**~~ — ✅ selesai 20-08-2026, lihat bagian T-2.
2. **T-1** — pasang guard di `redis.controller.ts`, atau hapus. Terbuka ke publik.
3. **T-3** — perbaiki `lockAndDestroy` supaya melempar `NotFoundException`; hentikan jejak
   audit palsu dan buang hash password dari `datajson`.
4. **T-4** — pasang `IdempotencyInterceptor` ke modul transaksi, bukan master data.
5. **T-5 / T-6** — perbaikan lanjutan, tidak mendesak.
