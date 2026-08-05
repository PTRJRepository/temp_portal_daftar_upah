# AGENTS_CONTEXT.md — Daftar Upah Portal

> **RULE BAGI SEMUA AGENT:** Sebelum mengerjakan apa pun terkait struktur/port/deploy, BACA file ini. Setelah mengubah struktur, port, versi, atau proxy — UPDATE file ini. Ini single source of truth struktur proyek. Konflik antara file ini dan kode = file ini harus diperbaiki (bukan kode dijauhi).

## Client/user akses

User mengakses app melalui **proxy gateway** di `D:\Server\Services\Main Dashboard\V1\proxy-gateway-portal` (Express, port 3001), BUKAN langsung ke port backend.

```
User browser → proxy gateway :3001 → /backend/upah/* → backend (:8002)  [diubah ke 8002 2026-08-05]
                                  → /upah/*          → backend serve dist (:8002)
```

Gateway routes JSON: `routes-config.json` (dev) & `routes-config.production.json` (prod, NODE_ENV=production). Hot-reload via `fs.watchFile` (server.js) — edit JSON langsung efek tanpa restart.
Putusan target daftar upah ada di 4 tempat: 2 di `routes-config.json` + 2 di `routes-config.production.json` (`/upah` + `/backend/upah`).

## Ringkasan arsitektur

- `backend/` — Bun + Elysia API server. Entry `src/index.ts`. Serve API **dan** frontend dist (`../frontend/dist`) + SPA fallback. Prefix `/backend/upah` di-strip di `onBeforeHandle`/route group.
- `frontend/` — React + Vite SPA. Production base `/upah/`. Build → `frontend/dist`.
- `versions/` — system rilis snapshot per versi, self-contained, runnable langsung. Hub: `versions/versions.ps1`.
- `graphify-out/` — knowledge graph (query via `/graphify` skill). Scope `backend/src` + `frontend/src` ONLY — `versions/*` TIDAK masuk graph.
- `dokumentasi/` — dokumentasi proyek.

## Port map (PENTING)

| Port | Service | Status |
|------|---------|--------|
| **3001** | Proxy gateway (proxy-gateway-portal, Express+Next) | RUNNING |
| 8001 | SQL Gateway db_api (Bun/MSSQL proxy) | RUNNING |
| **8002** | **Root app `backend/src` (PUBLISHED via proxy)** | RUNNING |
| 8005 | v1.5 release (dev only, snapshot usang) | RUNNING |
| 8007 | v2.1 release | down |
| 5175 | Vite dev (root frontend) | RUNNING |
| 5176 | Monitoring absen / attendance API | RUNNING |
| 5177 | Monitoring beras | — |
| 5178 | Google Drive file gateway | — |

**Yang dipublished = :8002** (proxy arahkan kesana, sesuai putusan 2026-08-05). Root :8002 serve frontend `frontend/dist` fresh built. 8005 = dev/lama; snapshot v1.5 frontend usang (5 file styles hilang, build `versions.ps1 build` gagal krn `print-optimization.css` resolve).

## Versions system (`versions/`)

- `versions/versions.ps1` — hub: `list / start [-Background] / stop / build / new`
- Registry port versi ada di blok `$Versions` atas file
- Tiap versi = snapshot source bersih (backend + frontend), `node_modules` = **junction** ke root (satu install, semua share)
- `new` = copy WORKING TREE (termasuk untracked), strip test/log/tmp, copy `.env`, junction
- `.env` di-copy tiap versi identik root (koneksi DB sama); `PORT` di-edit lewat `$env:PORT` runner, TIDAK ubah `.env`

## Backend entry contracts

Prefix route:
- `/auth`, `/payroll`, `/reports`, `/payroll/summary`, `/tax-report`, `/users`, `/dashboardRoutes`, `/history`, `/wages`, `/logs`, `/employeeHrData`, `/employeeComparison`, `/otherIncomes`, `/api/mill-production`
- Semua routes juga di-mount ulang di bawah `/backend/upah` group (proxy prefix)
- Utility: `/health`, `/api-info`
- `GET /payroll/locked/verify` — verifikasi token eksternal (RS256/HS256), dipakai frontend `verifyExternalToken()`; wajib ada di root + v1.5 + v2.1. Dipatch 2026-08-05 bersama fix key RSA missing di snapshot v1.5 & v2.1.export

## Perubahan yang WAJIB update file ini

- [x] Ganti versi yang dipublish → **8002** (2026-08-05, 4 tempat routes-config*.json)
- [ ] Tambah/hapus versi di `versions/`
- [ ] Ubah port default backend/frontend
- [ ] Tambah route/service baru
- [ ] Ubah struktur folder besar
- [ ] Pindah/rename gateway proxy
