# Patch Notes — Locked Kerani Auth

Tanggal: 2026-07-20

## Masalah sebelum patch
- `/backend/upah/payroll/locked/gangs?div=PG1A` balas `403 Forbidden` untuk mode locked Kerani.
- Backend Upah berhasil baca token, tapi user transient dari token gateway tidak punya division yang cocok.
- Console frontend: gang/divisi kosong karena `getLockedGangs()` gagal.

## Perubahan patch
- File: `backend/src/services/authService.ts`
- Token gateway dengan payload `userId` tanpa `sub` sekarang dipetakan lebih awal menjadi user transient.
- Mapping berlaku untuk token RS256 maupun HS256 selama payload berisi `userId`.
- Role token dinormalisasi: `admin`, `kerani`, `visitor`, default `user`.
- Division diambil dari `divisions`, `division`, atau `divisi`.
- Jika role `KERANI` dan division kosong, fallback aman dari username `kerani_*`:
  - `kerani_pg1a` menjadi `PG1A`
- Alias division dinormalisasi:
  - `AREC` menjadi `ARC`
  - `WORKSHOP AR`, `WORKSHOP_AR`, `WKS AR`, `HMC` menjadi `WKS_AR`
  - `WORKSHOP PG`, `WORKSHOP_PG`, `WKS PG`, `WORKSHOP P.G`, `WORKSHOP P.G.`, `AMC` menjadi `WKS_PG`
  - `NURSERY` menjadi `NRS`
  - `INFRA` menjadi `INF`
- Role `ADMIN`, `VISITOR`, atau division `ALL` mendapat `AuthService.ALL_DIVISIONS` seperti behavior lama.

## Yang tidak berubah
- Port tidak berubah.
- Backend Upah tetap port `8002`.
- Proxy Gateway tetap port `3001`.
- Route proxy tetap `/backend/upah` dan `/upah`.
- JWT secret/key tidak diubah.
- Database tidak diubah.
- Permission check locked gangs tetap aktif.

## Guardrails
- Jangan ubah port service tanpa instruksi eksplisit:
  - Proxy Gateway: `3001`
  - Upah Backend: `8002`
  - Query Gateway: `8001`
  - Absen: `5176`
  - Monitoring Beras: `5177`
  - File Gateway: `5178`
- Jangan matikan permission check `KERANI` di `/payroll/locked/gangs`.
- Jangan ubah token format dashboard; cukup dukung payload yang sudah ada.
- Jangan hapus route `/backend/upah` atau ubah `rewritePath: false` untuk backend API.
- Jangan commit log runtime `_tmp_*.log`, `.playwright-mcp/`, screenshot, database lokal, atau key private.

## Verifikasi
- `bun build backend/src/index.ts --target=bun --outfile %TEMP%/upah-backend-check.js` berhasil sebelum restart.
- Backend Upah direstart dan listen di port `8002`.
