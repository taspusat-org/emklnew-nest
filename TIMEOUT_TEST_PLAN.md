# Skema Uji Timeout — Modul User (CRUD)

Panduan **user testing manual** untuk memastikan konsep timeout FE ↔ BE benar-benar
berjalan: siapa yang menyerah duluan, apa yang dilihat user, dan apakah data di
database tetap konsisten setelah timeout. Bukan unit test / jest — semua dijalankan
lewat layar **Master User** (`/dashboard/user`) atau lewat curl.

Repo yang terlibat:

- Backend: `emklnew-nest` (interceptor timeout + rollback transaksi)
- Frontend: `emklnew-next` (timeout axios + overlay offline + alert)

> Untuk skenario **"user lambat, server cepat, lalu simpan ulang"** ada runbook
> tersendiri yang bisa diikuti dari atas ke bawah: [UJI_SIMPAN_ULANG.md](UJI_SIMPAN_ULANG.md).

---

## 1. Peta timeout yang berlaku sekarang

| Lapisan | Nilai | Sumber | Perilaku saat tercapai |
| --- | --- | --- | --- |
| FE — POST/PUT/PATCH/DELETE | **35.000 ms** | `lib/utils/AxiosInstance.ts` | `ECONNABORTED` → alert *"data mungkin sudah tersimpan"* + refetch daftar + `setProcessed()` |
| FE — GET/HEAD/OPTIONS | **60.000 ms** | `lib/utils/AxiosInstance.ts:24` | `ECONNABORTED` → **reject senyap**, tanpa alert (disengaja) |
| FE — response 408/504 | mengikuti BE | `lib/utils/AxiosInstance.ts` | timeout dari server → alert *"data tidak tersimpan"* untuk mutation, senyap untuk GET |
| FE — `Idempotency-Key` | per sesi form | `lib/hooks/useIdempotencyKey.ts` | dibuat saat modal dibuka; selama isian sama → kunci sama → backend membalas hasil kiriman pertama |
| FE — jaringan putus | seketika | `lib/utils/AxiosInstance.ts:39` | semua mutation in-flight di-`abort()` → `ERR_CANCELED` → overlay offline |
| BE — per route | `@SetRequestTimeout(ms)` | `src/common/decorators/set-timeout.decorator.ts` | tidak dipakai di modul user |
| BE — global | `REQUEST_TIMEOUT_MS` atau **30.000 ms** | `src/common/interceptors/timeout.interceptor.ts:13,33` | abort signal → rollback semua trx aktif → **HTTP 408** |
| BE — query setelah abort | — | `src/common/utils/db.ts` | `RequestTimeoutException`, bukan menggantung |
| Knex pool (pg) | max 30, acquire 10.000 ms | `src/knexfile.ts:20-21` | `Knex: Timeout acquiring a connection` |

> **Urutan yang disengaja:** FE mutation (35 dtk) dibuat **lebih lama** dari default BE
> (30 dtk) supaya yang memutuskan hampir selalu server. Vonis server pasti — 408 berarti
> transaksinya sudah di-rollback — sedangkan timeout browser tidak tahu apa-apa soal
> nasib datanya. Untuk memisahkan kedua jalur saat menguji, dipakai **preset
> konfigurasi** di bawah.

> **Retry:** react-query tidak lagi mengulang request yang gagal (`retry: false` di
> `components/layout/RootLayoutClient.tsx`). Satu-satunya retry yang tersisa adalah
> alur 401 → refresh token → kirim ulang di `AxiosInstance`. Jadi setiap request yang
> terlihat di Network saat pengujian = satu percobaan nyata. Kalau di mode dev masih
> terlihat GET dobel, itu React Strict Mode, bukan retry.

### Preset konfigurasi

| Preset | `.env` BE | Efek | Dipakai untuk |
| --- | --- | --- | --- |
| **A — BE ketat** | `REQUEST_TIMEOUT_MS=10000` | BE selalu menyerah duluan | Uji timeout & rollback BE (T06–T10) |
| **B — BE longgar** | `REQUEST_TIMEOUT_MS=120000` | FE selalu menyerah duluan | Uji timeout FE (T01–T05, T14) |
| **C — apa adanya** | `REQUEST_TIMEOUT_MS` dikosongkan | BE 30 dtk vs FE 35 dtk | Uji urutan kondisi produksi (T11) |

Ganti preset = ubah `.env` lalu **restart** `npm run start:dev`.

---

## 2. Persiapan lab

### 2.1 Aktifkan lab di backend

Tambahkan di `.env` backend:

```bash
TIMEOUT_LAB=1
```

Tanpa baris ini seluruh kode lab menjadi no-op (`src/common/utils/timeout-lab.ts`).
**Jangan pernah menyalakannya di server produksi.**

Lalu jalankan backend:

```bash
npm run start:dev
```

### 2.2 Arahkan frontend ke backend lokal

Kode lab hanya ada di backend lokal, sementara `.env` frontend saat ini menunjuk ke
server demo (`NEXT_PUBLIC_BASE_URL2=https://emkldemoapi.transporindo.com`). Ubah di
`.env` frontend, sesuaikan port dengan `PORT` di `.env` backend (sekarang `5004`):

```bash
NEXT_PUBLIC_BASE_URL=http://localhost:5004
NEXT_PUBLIC_BASE_URL2=http://localhost:5004
```

Restart frontend:

```bash
npm run dev
```

Verifikasi: buka DevTools → Network, muat `/dashboard/user`, pastikan request
`GET /user` mengarah ke `localhost:5004`.

### 2.3 Cara memicu proses lambat: token uji

Proses lambat dipicu lewat **isi data yang diketik user** — tidak perlu header, query
param, atau tool tambahan.

| Token | Ditulis di | Titik tahan | Yang diuji |
| --- | --- | --- | --- |
| `LABSLOW<detik>` | kolom **Nama** pada form Tambah/Edit | setelah `INSERT` / `UPDATE`, sebelum query berikutnya | rollback transaksi |
| `LABSLOW<detik>` | **username** baris yang dihapus | setelah baris dihapus di dalam trx | rollback delete |
| `LABSLOW<detik>` | kotak **search** grid | setelah COUNT, sebelum query data | timeout GET |
| `LABCACHE<detik>` | kolom **Nama** pada form Tambah/Edit | **setelah cache Redis ditulis**, sebelum commit | divergensi cache vs DB |
| `LABAFTER<detik>` | kolom **Nama** pada form Tambah/Edit | **setelah commit**, sebelum balasan dikirim | user lambat / server cepat — lihat [UJI_SIMPAN_ULANG.md](UJI_SIMPAN_ULANG.md) |

Contoh: nama `Budi LABSLOW45` → proses ditahan 45 detik. Maksimal 300 detik.

Kenapa sumbernya dipisah: **create/update** membaca token dari *Nama*, **delete** dari
*username*. Jadi user uji untuk skenario hapus bisa dibuat dengan cepat (username
`LABSLOW30`, nama biasa), baru penghapusannya yang lambat.

Titik injeksi ada di `src/modules/user/user.service.ts` — cari komentar
`// Titik uji timeout` pada `create()`, `update()`, `delete()`, dan `findAll()`.

### 2.4 Alat verifikasi

**Log backend** (terminal `start:dev`) — yang harus dicari:

```
[TIMEOUT] Request timed out after 10000ms, rolling back 1 transaction(s)
[TIMEOUT] Transaction auto-rolled back via abort signal
[TimeoutLab] [slow] menahan proses 30s (token LABSLOW30)
```

**Database** — cek apakah data benar-benar tersimpan / ter-rollback:

```sql
select id, username, name, created_at, updated_at
from dbo.users
where username like 'LAB%' or name like '%LAB%'
order by created_at desc;
```

```sql
select * from dbo.logtrail
where namatabel = 'users'
order by id desc
limit 5;
```

Logtrail ditulis di transaksi yang sama dengan data — kalau rollback bekerja, jejaknya
juga harus ikut hilang.

**Redis** — cek cache halaman grid:

```bash
redis-cli get users-page-1
```

**DevTools → Network** — kolom Status (`408`, `(canceled)`, `(failed)`), kolom Time, dan
header `Idempotency-Key` pada request mutasi.

### 2.5 Tabel idempotency

Skenario T14 memerlukan tabel `idempotencykey` (migration
`20260820000001_create_idempotencykey.ts`). Di database uji lokal tabel ini **sudah
dibuat**. Untuk environment lain:

```bash
npm run migrate:latest
```

Catatan: pada database `tasemkl_testing` perintah itu belum bisa dipakai — kolom `id` di
tabel `knex_migrations` tidak punya default sehingga knex gagal mencatat migrasi, dan ada
satu file migrasi lama yang namanya tercatat tapi filenya sudah tidak ada. Tabelnya karena
itu dibuat dengan menjalankan `up()` migrasinya langsung. Perbaiki dulu dua hal itu
sebelum mengandalkan `migrate:latest` di mana pun.

---

## 3. Matriks skenario

| No | Skenario | Preset | Pemicu | Yang diharapkan menyerah duluan |
| --- | --- | --- | --- | --- |
| T01 | Simpan user, server lambat | B | Nama `LABSLOW45` | FE (30 dtk) |
| T02 | Grid GET, server lambat | B | Search `LABSLOW70` | FE (60 dtk) |
| T03 | Simpan user, jaringan lambat | B | Throttling DevTools | FE (30 dtk) |
| T04 | Jaringan putus saat simpan | B | DevTools Offline | FE (seketika) |
| T05 | Jaringan putus saat grid load | B | DevTools Offline | FE (seketika) |
| T06 | BE timeout saat CREATE | A | Nama `LABSLOW30` | BE (10 dtk) |
| T07 | BE timeout saat UPDATE | A | Nama `LABSLOW30` | BE (10 dtk) |
| T08 | BE timeout saat DELETE | A | username `LABSLOW30` | BE (10 dtk) |
| T09 | BE timeout saat GET | A | Search `LABSLOW20` | BE (10 dtk) |
| T10 | Cache Redis vs rollback DB | A | Nama `LABCACHE30` | BE (10 dtk) |
| T11 | Balapan konfigurasi produksi | C | Nama `LABSLOW40` | ? (harus dicatat) |
| T12 | Pool koneksi habis | A | 35 request paralel | pool (10 dtk) |
| T13 | Job cetak/export tidak ikut mati | C | data user banyak | tidak ada |
| T14 | Simpan ulang setelah timeout | B | Nama `LABSLOW45` + Simpan 2x | FE (35 dtk), lalu replay |

---

## 4. Detail skenario

### Grup A — Timeout dari sisi frontend

#### T01 — Simpan user saat server lambat (FE menyerah duluan)

**Preset B** (`REQUEST_TIMEOUT_MS=120000`).

1. Buka `/dashboard/user`, klik **Tambah**.
2. Isi username `T01USER`, **Nama** `Uji Timeout LABSLOW45`, lengkapi field wajib.
3. Klik **Simpan**, nyalakan stopwatch.

**Ekspektasi**

- Detik 0–35: overlay **Processing** tampil.
- Detik ±35: muncul alert **"PERMINTAAN MELEBIHI BATAS WAKTU. DATA MUNGKIN SUDAH
  TERSIMPAN — PERIKSA DAFTARNYA DULU SEBELUM MENYIMPAN ULANG."**, overlay Processing
  hilang, form tetap terbuka dengan isian utuh, dan grid otomatis refetch.
- Log BE: `[TimeoutLab] [slow] menahan proses 45s` lalu proses **lanjut sampai selesai** —
  backend tidak pernah tahu browser sudah pergi, jadi datanya tetap di-commit.
- Setelah ±45 detik: refresh grid → baris `T01USER` **memang tersimpan**. Ini bukan bug,
  ini konsekuensi HTTP: browser yang berhenti menunggu tidak membatalkan pekerjaan server.
- Pesannya karena itu **tidak boleh** berbunyi "gagal" — itu yang memancing user menyimpan
  ulang dan membuat data dobel.

**Lanjutan wajib:** tanpa mengubah apa pun, tekan **Simpan** sekali lagi → lihat T14.
Harusnya tidak lahir user kedua.

**Verifikasi**

```sql
select id, username, name, created_at from dbo.users where username = 'T01USER';
```

---

#### T02 — Grid lambat, FE read timeout 60 detik

**Preset B.**

1. Di grid user, tempel (paste, jangan diketik) `LABSLOW70` di kotak search.
2. Tunggu.

**Ekspektasi**

- Detik 0–60: grid dalam keadaan loading.
- Detik ±60: axios membatalkan request. Sesuai desain **tidak ada alert** untuk GET.
- Catat kondisi layar: grid kosong tanpa pesan, tetap berputar, atau menampilkan data
  lama? Apakah user tahu harus melakukan apa?
- Log BE tetap menyelesaikan proses di detik 70 — koneksi dan transaksi tertahan sia-sia.

Catatan: kalau diketik satu per satu, setiap ketukan memicu request sendiri
(`LABSLOW7` = 7 detik, lalu `LABSLOW70` = 70 detik). Paste supaya hasilnya bersih.

---

#### T03 — Simpan user saat jaringan user lambat

**Preset B**, tanpa token (nama normal).

1. DevTools → **Network** → **Throttling** → **Add custom profile**: download `10 kb/s`,
   upload `10 kb/s`, latency `5000 ms`. Pilih profil itu.
2. Tambah user baru, klik **Simpan**.

**Ekspektasi**

- Jika total waktu (kirim + proses + terima) > 30 detik → alert **"Koneksi Timeout"**.
- BE tetap memproses dan menyimpan → sama seperti T01, cek database.
- Variasi kontrol: turunkan latency ke `2000 ms` sehingga request selesai < 30 detik →
  harus **berhasil normal** (toast sukses, baris fokus di grid). Ini memastikan timeout
  tidak menyala terlalu cepat pada koneksi lambat yang masih wajar.

---

#### T04 — Jaringan putus di tengah proses simpan

**Preset B**, nama `Uji Offline LABSLOW45`.

1. Klik **Simpan**.
2. Setelah ±5 detik, DevTools → Network → **Offline**.

**Ekspektasi**

- Seketika: mutation di-abort (`ERR_CANCELED`), muncul **overlay offline** fullscreen,
  overlay Processing hilang.
- BE **tidak tahu** dan tetap commit di detik 45.
- Kembalikan ke **Online**, tutup overlay, refresh grid → baris kemungkinan sudah ada.
  Catat: apakah user diberi tahu bahwa datanya mungkin sudah tersimpan?

---

#### T05 — Jaringan putus saat grid sedang memuat

**Preset B.**

1. Set Network → **Offline**.
2. Refresh halaman grid atau pindah halaman paging.

**Ekspektasi**

- GET gagal tanpa response → overlay offline tampil (jalur `!error.response` +
  `navigator.onLine === false`).
- Catat perbedaannya dengan T02: GET yang **timeout** senyap, GET yang **offline**
  memunculkan overlay. Dua kegagalan jaringan, dua pengalaman berbeda.

---

### Grup B — Timeout dari sisi backend

#### T06 — BE timeout + rollback saat CREATE

**Preset A** (`REQUEST_TIMEOUT_MS=10000`).

1. Tambah user: username `T06USER`, nama `Uji Rollback LABSLOW30`.
2. **Simpan.**

**Ekspektasi**

- Detik ±10 log BE:
  `[TIMEOUT] Request timed out after 10000ms, rolling back 1 transaction(s)`
- Response **HTTP 408** di tab Network.
- Detik ±30 (setelah tahanan selesai): log menunjukkan query lanjutan ditolak
  `RequestTimeoutException` — proses berhenti, bukan menggantung menahan koneksi.
- **Database: baris `T06USER` TIDAK boleh ada**, dan tidak ada baris `logtrail` untuk
  user itu.
- **Di layar:** dialog **"Koneksi Timeout"** harus muncul. Sebelumnya tidak: alert axios
  hanya menyala untuk `ECONNABORTED`, sedangkan 408 adalah response nyata dari server
  sehingga lolos dari jalur itu, dan `GridUser` hanya `console.error` untuk error
  non-400 — mutation gagal tanpa pesan apa pun. Sekarang 408/504 ikut ditangani sebagai
  timeout di `AxiosInstance`.

**Verifikasi**

```sql
select count(*) from dbo.users where username = 'T06USER';
```

---

#### T07 — BE timeout + rollback saat UPDATE

**Preset A.**

1. Pilih user yang ada, klik **Edit**.
2. Ubah **Nama** menjadi `Nama Baru LABSLOW30`, ubah juga satu field lain (mis. email).
3. **Simpan.**

**Ekspektasi**

- HTTP 408 di detik ±10, log rollback muncul.
- Database: **nama & email lama tetap**, `updated_at` tidak berubah.
- Grid setelah refresh menampilkan nilai lama.

---

#### T08 — BE timeout + rollback saat DELETE

**Preset A.**

1. Buat user uji dengan **username `LABSLOW30`** dan nama biasa (create-nya cepat,
   karena token untuk delete dibaca dari username).
2. Pilih baris itu → **Hapus** → konfirmasi.

**Ekspektasi**

- Detik ±10: 408 + log rollback.
- Baris **masih ada** di database — `lockAndDestroy` ikut ter-rollback.
- Catat perilaku grid: baris dibuang dari tampilan hanya di `onSuccess`, jadi seharusnya
  baris tetap terlihat. Kalau baris hilang dari layar padahal masih ada di DB, itu
  temuan: grid berbohong sampai refresh berikutnya.

---

#### T09 — BE timeout saat GET grid

**Preset A.**

1. Paste `LABSLOW20` di kotak search.

**Ekspektasi**

- Detik ±10: 408 dari BE (FE belum mendekati 60 detik).
- `getAllUserFn` membungkus error jadi `Failed to fetch data` → react-query error.
- Catat: grid menampilkan pesan, kosong, atau tetap loading?

---

#### T10 — Cache Redis vs rollback database

**Preset A**, token `LABCACHE30` — menahan **setelah** cache halaman ditulis, sebelum commit.

1. Catat isi cache sebelum uji: `redis-cli get users-page-1`.
2. Tambah user: username `T10USER`, nama `Uji Cache LABCACHE30`.
3. **Simpan** → tunggu 408.

**Ekspektasi / yang diselidiki**

- Database: `T10USER` **tidak ada** (rollback bekerja).
- Redis: cache `users-page-*` ditulis sebelum commit dan Redis tidak ikut transaksi —
  jadi cache berpotensi masih memuat baris hantu `T10USER`.
- Refresh grid, bandingkan isi grid dengan hasil query SQL. Kalau grid menampilkan baris
  yang tidak ada di DB, itu temuan konsistensi cache (aturan #7 di `CLAUDE.md`).

---

### Grup C — Beban dan batas

#### T11 — Urutan konfigurasi produksi (BE 30 dtk, FE 35 dtk)

**Preset C** (kosongkan `REQUEST_TIMEOUT_MS`), nama `Uji Balapan LABSLOW40`.

1. Simpan, amati mana yang terjadi lebih dulu. Ulangi 3 kali.

**Ekspektasi**

- **Server yang menang setiap kali**: 408 di detik ±30, lima detik sebelum browser
  menyerah. Pesannya "DATA TIDAK TERSIMPAN" — dan itu memang pasti, karena 408 berarti
  transaksi sudah di-rollback.
- Kalau justru pesan "DATA MUNGKIN SUDAH TERSIMPAN" yang muncul, berarti jaraknya terlalu
  tipis untuk kondisi jaringan setempat (response 408-nya sendiri terlambat sampai).
  Catat berapa kali dari 3 percobaan, lalu pertimbangkan menaikkan `MUTATION_TIMEOUT_MS`.

---

#### T12 — Pool koneksi habis karena request lambat menumpuk

**Preset A.** Pool pg: `max: 30`, `acquireTimeoutMillis: 10000`.

1. Ambil token dari DevTools (request `GET /user` → header `Authorization`).
2. Jalankan:

```bash
node scripts/timeout-lab-burst.js <TOKEN> 35 20
```

3. Selagi script jalan, pakai grid user di browser seperti biasa.

**Ekspektasi**

- 35 request menahan transaksi 20 detik, sementara pool hanya punya 30 koneksi.
- Sebagian request gagal `Timeout acquiring a connection` → di FE dipetakan jadi
  **"KONEKSI KE SERVER TERPUTUS. SILAKAN COBA LAGI."** (`lib/utils/errorMessage.ts`).
- Sebagian lagi kena 408 dari interceptor.
- Catat: apakah aplikasi masih bisa dipakai user lain saat pool jenuh, dan berapa lama
  pulih setelah burst selesai.

---

#### T13 — Cetak laporan & export tidak boleh ikut ter-timeout

**Preset C.** Cetak/export berjalan sebagai background job; request-nya membalas
`{ jobId }` seketika, jadi timeout request **tidak boleh** membunuh job.

1. Kosongkan filter grid (data sebanyak mungkin), klik **Cetak**, lalu **Export**.
2. Amati toast progres dan event socket `report:progress`.

**Ekspektasi**

- Request `POST /user/report` dan `POST /user/export` selesai < 1 detik.
- Job tetap berjalan melewati 30 detik; PDF/Excel tetap bisa diunduh.
- Kalau job mati di detik 30, berarti ada jalur job yang keliru menempel ke request
  context.

---

#### T14 — Idempotency: simpan ulang setelah timeout tidak membuat data dobel

Ini penutup dari T01: browser menyerah, backend tetap commit, lalu user menyimpan ulang.
Kunci `Idempotency-Key` yang membuat kiriman kedua tidak melahirkan user kedua.

**Preset B** (`REQUEST_TIMEOUT_MS=120000`).

1. Tambah user: username `T14USER`, nama `Uji Idempotency LABSLOW45`. **Simpan.**
2. Detik ±35 muncul dialog "DATA MUNGKIN SUDAH TERSIMPAN". Tutup dialognya.
3. **Tanpa mengubah isian apa pun**, tekan **Simpan** lagi.

**Ekspektasi**

- Di Network, request kedua membawa header `Idempotency-Key` dengan nilai yang **sama
  persis** seperti request pertama.
- Request kedua dijawab cepat (tidak menunggu 45 detik lagi) dengan isi yang sama seperti
  hasil kiriman pertama, dan log BE menulis `replay idempotency key ...`.
- Request kedua **tidak** ditolak dengan 400 "User dengan Username ini sudah ada":
  pengenalan kunci dijalankan `IdempotencyInterceptor`, yang di NestJS berjalan sebelum
  pipe validasi zod.
- Database: `T14USER` hanya **satu** baris.

**Verifikasi**

```sql
select count(*) from dbo.users where username = 'T14USER';
```

```sql
select key, modifiedby, method, endpoint, statuscode, created_at
from dbo.idempotencykey order by created_at desc limit 5;
```

Bentuk kuncinya `user-add-20260820T113045-<uuid v4>`: label + waktu hanya untuk
penelusuran, keunikannya datang dari UUID acak. Kolom `modifiedby` adalah pemilik kunci —
pencarian selalu dibatasi ke user yang login, dan unique constraint-nya `(key, modifiedby)`.

**Variasi yang wajib ikut diuji**

| Variasi | Langkah | Ekspektasi |
| --- | --- | --- |
| Isian diubah | Setelah timeout, ubah nama lalu Simpan | Kunci **baru** (permintaan memang beda) → tersimpan, **bukan** 409 |
| Rollback backend | Preset A, nama `LABSLOW30`, setelah 408 tekan Simpan lagi | Kunci ikut hilang saat rollback → simpanan kedua benar-benar menyimpan, bukan replay |
| Klik dobel | Klik **Simpan** dua kali cepat | Satu request kalah di unique constraint lalu membalas hasil pemenang — bukan error 500 dan bukan dua baris |
| Simpan & Tambah | Simpan & Tambah berhasil, lalu isi data berikutnya | Kunci baru untuk baris kedua (kunci lama sudah dilepas saat sukses) |
| Modal ditutup–dibuka | Setelah timeout, tutup modal lalu buka lagi dan ketik data yang sama | Kunci **baru** — proteksi hanya berlaku selama modal tidak ditutup; pengamannya grid yang sudah ikut refetch |
| Tanpa kunci | Kirim `POST /user` lewat curl tanpa header | Jalan seperti biasa (header opsional, modul lain tidak terpengaruh) |
| Beda user | Dua user login berbeda memakai nilai kunci yang sama | Masing-masing hanya melihat hasilnya sendiri (pencarian dibatasi kolom `modifiedby`) |

---

## 5. Lembar hasil

Isi saat pengujian. "Sesuai" = perilaku sama dengan kolom Ekspektasi di atas.

| No | Preset | Tanggal | FE terlihat apa | HTTP status | Data di DB | Sesuai? | Catatan |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T01 | B | | | | | | |
| T02 | B | | | | | | |
| T03 | B | | | | | | |
| T04 | B | | | | | | |
| T05 | B | | | | | | |
| T06 | A | | | | | | |
| T07 | A | | | | | | |
| T08 | A | | | | | | |
| T09 | A | | | | | | |
| T10 | A | | | | | | |
| T11 | C | | | | | | |
| T12 | A | | | | | | |
| T13 | C | | | | | | |
| T14 | B | | | | | | |

---

## 6. Uji backend tanpa frontend (isolasi)

Berguna untuk memastikan sebuah temuan berasal dari FE atau BE. Ambil token dari
DevTools, lalu di PowerShell:

```powershell
$token = "PASTE_TOKEN_DISINI"; Measure-Command { curl.exe -s -o resp.json -w "status=%{http_code}" "http://localhost:5004/user?page=1&limit=10&search=LABSLOW20" -H "Authorization: Bearer $token" }
```

- Preset A → `status=408` sekitar detik ke-10.
- curl tidak punya timeout klien di sini, jadi apa pun yang terlihat murni perilaku
  backend.

Untuk POST, salin request `POST /user` dari tab Network (klik kanan → Copy → Copy as
cURL), lalu ganti nilai `name` menjadi `... LABSLOW30`.

---

## 7. Membersihkan setelah pengujian

1. Hapus `TIMEOUT_LAB=1` dan `REQUEST_TIMEOUT_MS` dari `.env` backend, restart.
2. Kembalikan `NEXT_PUBLIC_BASE_URL` / `NEXT_PUBLIC_BASE_URL2` di frontend.
3. Bersihkan data uji — lihat dulu, baru hapus:

```sql
select id, username, name from dbo.users where username like 'T0%USER' or username like 'LABSLOW%';
```

```sql
delete from dbo.users where username like 'T0%USER' or username like 'T14USER' or username like 'LABSLOW%';
```

4. Kosongkan cache grid bila perlu: `redis-cli del users-page-1`.
5. Kunci idempotency dari pengujian boleh dibuang (baris lama tidak mengganggu, hanya
   menumpuk):

```sql
delete from dbo.idempotencykey where created_at < now() - interval '7 days';
```

Kode lab (`src/common/utils/timeout-lab.ts` plus pemanggilan `labDelay` di
`user.service.ts`) boleh ditinggal — tanpa `TIMEOUT_LAB=1` semuanya no-op. Untuk
mencabutnya: hapus file itu beserta semua baris berkomentar `// Titik uji timeout`.

---

## 8. Kalau proses tetap selesai cepat (lab tidak jalan)

Urut dari penyebab paling sering:

1. **Backend belum di-restart.** `.env` dibaca sekali saat proses start; mengubahnya
   pada server yang sudah jalan tidak berpengaruh, dan watch mode `start:dev` pun tidak
   ikut restart karena `.env` bukan file sumber. Matikan lalu jalankan lagi.
2. **Backend jalan dari `dist/` yang lama.** `node dist/main` memakai hasil build, bukan
   `src/`. Build ulang dulu (`npm run build`) atau jalankan `npm run start:dev`.
3. **Request tidak sampai ke backend lokal.** Lihat terminal backend saat menyimpan —
   harus ada baris `TimeoutInterceptor POST /user`. Kalau tidak ada, frontend masih
   menembak server lain. Ubah `NEXT_PUBLIC_BASE_URL2` lalu **restart `npm run dev`**;
   variabel `NEXT_PUBLIC_*` ditanam saat build, tidak dibaca ulang saat runtime.
4. **Token di kolom yang salah.** Create/update membaca token dari **Nama**, delete dari
   **username** baris yang dihapus, grid dari kotak **search**.
5. **Preset masih C.** Tanpa `REQUEST_TIMEOUT_MS`, FE (30 dtk) dan BE (30 dtk) jatuh
   tempo bersamaan sehingga hasilnya ambigu. Pakai preset A atau B lebih dulu.

Penanda di log backend:

| Yang terlihat | Artinya |
| --- | --- |
| `[TimeoutLab] [slow] menahan proses 30s` | lab aktif dan token terbaca — sudah benar |
| `token LABSLOW30 terdeteksi tapi TIMEOUT_LAB belum aktif di proses ini` | kode lab sudah jalan, `.env` belum terbaca → restart backend |
| hanya `TimeoutInterceptor POST /user`, tanpa baris `[TimeoutLab]` | token tidak terbaca (kolom salah) atau kode lab belum ikut ter-build |
| tidak ada baris apa pun | request tidak sampai ke backend ini |
