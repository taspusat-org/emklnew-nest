# Uji: User Lambat, Server Cepat, lalu Simpan Ulang

Runbook untuk satu skenario spesifik — yang paling sering terjadi di lapangan dan paling
berbahaya:

> Data **berhasil masuk dan ter-commit** di server, tetapi balasannya tidak sampai ke
> browser tepat waktu. User melihat pesan timeout, mengira gagal, lalu menekan SIMPAN
> lagi.

Yang dibuktikan runbook ini:

1. Backend tetap commit walau browser sudah menyerah — ini perilaku HTTP, bukan bug.
2. Pesan yang muncul tidak berbohong ("data **mungkin** sudah tersimpan", bukan "gagal").
3. Grid otomatis menarik ulang data sehingga user melihat kondisi sebenarnya.
4. Simpan ulang **tidak** membuat user kedua — dijawab hasil kiriman pertama.

Persiapan umum (mengaktifkan lab, mengarahkan frontend ke backend lokal) ada di
[TIMEOUT_TEST_PLAN.md](TIMEOUT_TEST_PLAN.md) bagian 2.

---

## 1. Kondisi yang harus dibuat

Supaya skenarionya benar, tiga hal harus terjadi berurutan:

| Urutan | Harus |
| --- | --- |
| 1 | Request **sampai** ke server dengan cepat |
| 2 | Server memproses dan **commit** dengan cepat |
| 3 | **Balasannya** yang terlambat sampai ke browser, lewat dari 35 detik |

> **Jangan pakai throttling latency biasa.** DevTools menerapkan latency sebelum request
> dikirim, jadi kalau latency-nya 40 detik, browser sudah menyerah **sebelum server
> menerima apa pun** — datanya tidak pernah masuk dan skenarionya meleset. Yang harus
> diperlambat adalah jalur **balasan**, bukan jalur berangkat.

Dua cara membuatnya, pakai salah satu. Cara A untuk hasil yang bisa diulang persis, cara B
untuk membuktikan hal yang sama dengan jaringan lambat sungguhan.

---

## 2. Persiapan

| # | Langkah | Cara memastikan |
| --- | --- | --- |
| 1 | `.env` backend: `TIMEOUT_LAB=1` | — |
| 2 | `.env` backend: `REQUEST_TIMEOUT_MS=120000` | Backend sengaja dibuat longgar supaya yang menyerah adalah browser, bukan server |
| 3 | **Build ulang + restart backend** | Log start-up muncul lagi di terminal |
| 4 | `.env` frontend menunjuk backend lokal, lalu `npm run dev` di-restart | Network menunjukkan request ke `localhost:5004` |
| 5 | Tabel `idempotencykey` ada | `select count(*) from dbo.idempotencykey;` jalan tanpa error |
| 6 | DevTools terbuka di tab **Network**, opsi *Preserve log* menyala | — |

Siapkan juga terminal backend agar terlihat, dan satu jendela SQL.

---

## 3. Cara A — deterministik (token `LABAFTER`)

Token `LABAFTER<detik>` menahan **balasan** selama sekian detik **sesudah commit**. Dari
sudut pandang browser hasilnya sama persis dengan jaringan user yang lambat: datanya sudah
masuk, balasannya belum datang.

### Langkah

1. Buka `/dashboard/user`, klik **Tambah**.
2. Isi:
   - Username: `T20USER`
   - Nama: `Uji Simpan Ulang LABAFTER45`
   - Lengkapi field wajib lainnya.
3. **Sebelum menekan Simpan**, buka DevTools → Network. Nanti request `POST /user` akan
   muncul di sini.
4. Klik **Simpan**, nyalakan stopwatch.

### Titik periksa

| Waktu | Yang harus terlihat | Di mana |
| --- | --- | --- |
| ±0 dtk | `TimeoutInterceptor POST /user` | Terminal backend |
| ±0 dtk | `[TimeoutLab] [after] menahan proses 45s (token LABAFTER45)` | Terminal backend |
| ±1 dtk | **Baris `T20USER` sudah ada di database** walaupun user belum dapat balasan | SQL (query di bawah) |
| 0–35 dtk | Overlay **Processing** menutup layar | Browser |
| ±35 dtk | Dialog: *"PERMINTAAN MELEBIHI BATAS WAKTU. DATA MUNGKIN SUDAH TERSIMPAN — PERIKSA DAFTARNYA DULU SEBELUM MENYIMPAN ULANG."* | Browser |
| ±35 dtk | `POST /user` berstatus **(canceled)**, waktu ±35 dtk | Network |
| ±35 dtk | Grid menarik ulang data sendiri — `GET /user` baru muncul | Network |
| ±35 dtk | Modal **tetap terbuka** dengan isian utuh | Browser |
| ±45 dtk | `[TimeoutLab] [after] tahan 45s selesai` — server menyelesaikan balasan yang tidak ada lagi yang menunggu | Terminal backend |

Cek database pada detik ke-5, jangan menunggu selesai — ini inti pembuktiannya:

```sql
select id, username, name, created_at from dbo.users where username = 'T20USER';
```

Harus **sudah ada** satu baris, padahal user masih melihat overlay Processing.

### Simpan ulang

5. Tutup dialog. **Jangan ubah apa pun** di form.
6. Klik **Simpan** sekali lagi.

| Yang harus terlihat | Kenapa |
| --- | --- |
| Request kedua membawa header `Idempotency-Key` **sama persis** dengan request pertama (Network → Headers) | Kunci dibuat sekali saat modal dibuka dan tidak berubah selama isian tidak berubah |
| Balasannya datang **seketika**, bukan menunggu 45 detik lagi | Pengecekan kunci jalan di interceptor, sebelum validasi dan sebelum transaksi dibuka |
| `replay idempotency key user-add-...` | Terminal backend |
| Modal tertutup, grid memfokuskan baris `T20USER` seperti simpan yang normal | Frontend menerima hasil kiriman pertama, bukan error |
| **Tidak** muncul 400 "User dengan Username ini sudah ada" | Interceptor jalan sebelum pipe zod |

Bukti akhir:

```sql
select count(*) from dbo.users where username = 'T20USER';
```

```sql
select key, modifiedby, method, endpoint, created_at
from dbo.idempotencykey order by created_at desc limit 3;
```

`count` harus **1**, dan hanya ada **satu** baris kunci untuk aksi tadi.

---

## 4. Cara B — jaringan lambat sungguhan

Membuktikan hal yang sama tanpa token, memakai throttling yang benar: **turunkan
download, biarkan upload dan latency normal.** Request berangkat cepat, server commit
cepat, balasannya yang merangkak.

1. DevTools → Network → Throttling → **Add custom profile**:
   - Download: `5` kb/s
   - Upload: `10000` kb/s
   - Latency: `0` ms
2. Pilih profil itu.
3. Tambah user `T21USER` dengan nama biasa (tanpa token), klik **Simpan**.

Balasan `POST /user` berisi `pagedData` beberapa halaman grid, jadi pada 5 kb/s
pengunduhannya lewat dari 35 detik.

| Titik periksa | Ekspektasi |
| --- | --- |
| Terminal backend | Tidak ada baris `[TimeoutLab]` sama sekali — server bekerja normal dan cepat |
| SQL detik ke-5 | `T21USER` **sudah** ada |
| ±35 dtk | Dialog "DATA MUNGKIN SUDAH TERSIMPAN" |
| Setelah dialog muncul | **Matikan throttling** (kembali ke *No throttling*) supaya verifikasi berikutnya tidak ikut merangkak |
| Simpan ulang | Sama seperti Cara A: replay, satu baris saja |

Kalau dialog tidak muncul karena balasannya ternyata cukup kecil dan selesai < 35 detik,
turunkan download ke `1` kb/s atau perbesar `limit` grid supaya `pagedData`-nya lebih
gemuk.

---

## 5. Variasi wajib

| # | Langkah | Ekspektasi |
| --- | --- | --- |
| V1 | Setelah timeout, **ubah nama** lalu Simpan | Kunci baru dibuat → benar-benar menyimpan, **bukan** 409. Permintaannya memang berbeda |
| V2 | Setelah timeout, tutup modal → buka lagi → ketik data yang sama | Kunci baru (proteksi berakhir bersama sesi form). Pengamannya grid yang sudah ikut refetch — baris pertama sudah kelihatan di sana |
| V3 | Klik **Simpan** dua kali sangat cepat | Satu request kalah di unique constraint lalu dibalas hasil pemenang. Bukan 500, bukan dua baris |
| V4 | Simpan & Tambah berhasil, lalu isi data berikutnya | Kunci baru untuk baris kedua |
| V5 | Ulangi Cara A untuk **Edit** (ubah nama jadi `... LABAFTER45`) | Perilaku sama: perubahan sudah tersimpan, simpan ulang di-replay |

### V6 — kasus batas yang perlu diketahui

Preset **C** (`REQUEST_TIMEOUT_MS` dikosongkan → backend 30 detik) dengan nama
`Uji Batas LABAFTER35`:

- Backend commit di detik ±1, lalu menahan balasan 35 detik.
- Timer timeout backend menyala di detik 30 — **setelah** commit — dan menjawab 408.
- Dialog yang muncul berbunyi "DATA TIDAK TERSIMPAN", padahal datanya **sudah** tersimpan.

Ini jendela sempit yang memang belum tertutup: 408 dikirim oleh interceptor yang tidak tahu
transaksinya sudah terlanjur commit. Di produksi ini hanya terjadi kalau commit selesai
persis di sekitar detik ke-30. Yang menyelamatkan tetap idempotency: tekan Simpan lagi,
kuncinya sudah ikut ter-commit bersama datanya, jadi user tetap mendapat hasil yang benar
dan tidak ada data dobel. Catat hasilnya di sini kalau ikut diuji.

---

## 6. Lembar hasil

| # | Titik periksa | Ekspektasi | Hasil | Catatan |
| --- | --- | --- | --- | --- |
| 1 | Data ada di DB sebelum balasan sampai | Ada | | |
| 2 | Dialog "DATA MUNGKIN SUDAH TERSIMPAN" di ±35 dtk | Muncul | | |
| 3 | Grid refetch otomatis | Ya | | |
| 4 | Modal tetap terbuka | Ya | | |
| 5 | Simpan ulang memakai kunci sama | Ya | | |
| 6 | Simpan ulang dijawab seketika | Ya | | |
| 7 | Log `replay idempotency key` | Muncul | | |
| 8 | Jumlah baris `T20USER` | 1 | | |
| 9 | V1 isian diubah | Tersimpan, bukan 409 | | |
| 10 | V3 klik dobel | 1 baris | | |

---

## 7. Kalau hasilnya berbeda

| Gejala | Penyebab paling mungkin | Perbaikan |
| --- | --- | --- |
| Simpan ulang dijawab 400 "User dengan Username ini sudah ada" | Backend masih memakai build lama, interceptor idempotency belum aktif | `npm run build` lalu restart backend |
| Terbentuk **dua** baris user | Header `Idempotency-Key` tidak sampai | Cek Request Headers di Network; cek preflight `OPTIONS /user` menjawab 204 dan `Access-Control-Allow-Headers` memuat `Idempotency-Key` |
| Simpan ulang menunggu 45 detik lagi | Kuncinya berbeda | Isian berubah tanpa disadari (spasi, huruf besar otomatis). Bandingkan kedua nilai header |
| Dialog berbunyi "DATA TIDAK TERSIMPAN" | Yang menjawab justru 408 dari backend | `REQUEST_TIMEOUT_MS` belum 120000, atau backend belum di-restart setelah `.env` diubah |
| Tidak ada baris `[TimeoutLab]` di log (Cara A) | Lab mati atau token salah kolom | Token untuk create/edit dibaca dari kolom **Nama**; pastikan `TIMEOUT_LAB=1` dan backend sudah restart |
| Data tidak masuk sama sekali | Request tidak pernah sampai ke server | Throttling latency terlalu besar — pakai profil sesuai bagian 4 (download kecil, latency 0) |

---

## 8. Bersih-bersih

```sql
select id, username, name from dbo.users where username in ('T20USER', 'T21USER');
```

```sql
delete from dbo.users where username in ('T20USER', 'T21USER');
```

```sql
delete from dbo.idempotencykey where endpoint like '/user%' and created_at < now() - interval '1 day';
```

Lalu kembalikan `.env` backend (hapus `TIMEOUT_LAB` dan `REQUEST_TIMEOUT_MS`), restart, dan
matikan throttling di DevTools.
