# Versions — Daftar Upah Portal versioning

Folder rilis **source bersih** per versi (tanpa test, log, tmp, node_modules duplikat).
Bisa menjalankan beberapa versi berbarengan di port beda, dan kapan saja kembali ke versi lama = tinggal start versi itu.

## Struktur

```
versions/
├── versions.ps1          <- HUB: list / start / stop / build / new
├── README.md
├── _logs/                <- log backend tiap versi (mode background)
├── v1.5/                 <- contoh versi (port 8005)
│   ├── backend/
│   └── frontend/
└── v2.1/                 <- contoh versi (port 8007)
```

Tiap folder versi berisi: `backend/` (src + data + .env), `frontend/` (src + config + dist build).
`node_modules` = **junction** (pointer) ke folder utama — satu install fisik dipakai semua versi → hemat disk.
Test/log/tmp di-exclude; `.env` & `.gitignore` ikut root.

---

## Tata cara pakai

Semua perintah dari folder `versions/`:

### Melihat daftar versi + status
```powershell
.\versions.ps1 list
```
```
Versi terdaftar:
  v1.5     stopped  (port 8005)
  v2.1     RUNNING  (port 8007)
```

### Menjalankan sebuah versi
```powershell
# foreground (terus jalan, ctrl+c utk berhenti)
.\versions.ps1 start -Version v1.5

# background (buka app tetap ketutup; log ke _logs/v1.5.log)
.\versions.ps1 start -Version v1.5 -Background
```
Kalau `dist/` frontend versi itu belum ada, otomatis build dulu sebelum start.
Akses: `http://localhost:<port>` (v1.5 = 8005).

### Paksa build ulang frontend
```powershell
.\versions.ps1 build -Version v1.5
```

### Menghentikan sebuah versi
```powershell
.\versions.ps1 stop -Version v1.5
```

---

## Tata cara membuat versi baru (misal v2.1)

```powershell
.\versions.ps1 new -Version v2.1 -Port 8007
```
- `-Version` = nama versi. `-Port` = port backend (default = 8005 + jumlah versi).
- `new` menyalin **working tree saat ini** (source yang sedang jalan, termasuk file yang belum di-commit seperti komponen baru) — bukan dari commit tertentu. `-Ref` diabaikan; buat versi dari commit lama = checkout branch dulu secara terpisah.
- Yang dilakukan `new`:
  1. salin `backend/src` + `backend/data` + config, dan `frontend/src` + config ke folder versi
  2. buang file test/log/tmp (pola `*.test.*`, `*.spec.*`, `_tmp*`, `tsconfig.tsbuildinfo`, `src/tests`, `src/logs`)
  3. copy `.env` dari backend utama (koneksi DB sama)
  4. buat junction `node_modules` (shared — tidak duplikat)
  5. daftarkan di folder + tampilkan baris registry yang perlu kamu tambah

**PENTING:** `new` tidak bisa menulis baris registry ke `versions.ps1` sendiri. Setelah `new`, buka `versions.ps1` dan tambah baris di blok `$Versions`:
```powershell
$Versions = @{
    "v1.5" = @{ Port = 8005 }
    "v2.1" = @{ Port = 8007 }
}
```
Lalu: `.\versions.ps1 build -Version v2.1` → `.\versions.ps1 start -Version v2.1`.

> Atau, kalau lebih suka bikin manual: copy pola folder `v1.5`, junction 2 node_modules, tambah 1 baris registry.

---

## Workflow rollback / blue-green

Konsep: **tidak pernah membuang versi lama** — tiap versi jalan di port sendiri, bisa berbarengan.

| Skenario | Caranya |
|---|---|
| Uji versi baru tanpa ganggu yang lama | `start -Version v2.1` (8007) — v1.5 di 8005 tetap jalan |
| Beralih resmi ke versi baru | arahkan user/entry ke port versi baru (8007) |
| Ada yang salah → kembali ke lama | `start -Version v1.5` (8005) — v1.5 masih jalan, tinggal arahkan kembali |
| Pembersihan versi yang gak dipakai | `stop` + hapus folder + hapus baris registry |

Karena versi lama tetap hidup di portnya, rollback = instan (tidak perlu rebuild/install).
Untuk cutover yang benar-benar mulus (beralih otomatis tanpa ganti URL manual), tambahkan reverse-proxy (Nginx) yang pointer-nya dialihkan ke port target — lihat pembahasan blue-green deployment.

---

## Skala disk

- Source bersih per versi ≈ 15 MB (backend + frontend + data) karena `node_modules` = junction.
- Menambah versi = bertambah ~15 MB, BUKAN ~500 MB per versi.
- `_logs/` per versi kecil; bersihkan sesekali.

## Catatan

- Jangan commit `.env` (secret) — root `.gitignore` sudah exclude.
- Junction `node_modules` tidak ikut git.
- Backend memakai `bun`; pastikan `bun` di PATH (`npm i -g bun` bila perlu).
