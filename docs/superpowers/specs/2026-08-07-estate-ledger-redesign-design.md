# Estate Ledger — Redesign Dashboard, Executive Board & Tema

Tanggal: 2026-08-07 · Status: disetujui (pendekatan A) · Cakupan: `frontend/` + 3 endpoint backend dashboard

## Latar & masalah

1. **DashboardHome kosong data** — hanya hero gradient + filter + launcher; tidak ada KPI/chart padahal endpoint `executive-summary` dan komponen `StatCard` sudah tersedia.
2. **Executive board tidak sinkron soal "semua gang"** — KPI/tren memakai `scope='panen'` (gang suffix `H`), tetapi chart gang (`gang-comparison`, `top-bottom-gangs`, `all-gangs-trend`) selalu menampilkan semua gang; dropdown gang & gang-type di header tidak tersambung ke fetch mana pun; klik anomali di InsightStrip salah arah (gang code dikirim ke drill divisi).
3. **Tema terasa "AI slop"** — hero gradient hijau 115–135° + motif daun + glass pill direplikasi ke semua halaman; token warna diduplikasi dengan nilai berbeda tipis; chart memakai palet rainbow hardcoded; LoadingScreen navy-amber off-brand; cost/ton ungu; emoji sebagai ikon.

## Keputusan desain: "Estate Ledger"

Editorial-data cockpit bernuansa ledger cetak premium. Dials: VARIANCE 6 / MOTION 4 / DENSITY 8.

### Palet (SSOT: `tokens.css` OKLCH; mirror hex: `reportTheme.jsx` `C`)

| Token | Nilai | Pakai untuk |
|---|---|---|
| paper | `#F7F5EF` | latar halaman |
| pageBg | `#F0EEE6` | latar konten |
| surface | `#FFFFFF` | kartu/panel flat |
| ink | `#15211A` | teks utama |
| ink2 | `#3D4A41` | teks sekunder |
| muted | `#6E7A70` | label, caption |
| rule | `#E0DED2` | hairline/border |
| leaf (SATU aksen) | `#1F6F43` | aksi primer, seri utama, state aktif |
| premi (teal) | `#0F766E` | semantik premi |
| lembur (amber buah sawit) | `#B45309` | semantik lembur/peringatan |
| potongan (bata) | `#B3392E` | semantik potongan/bahaya |
| costTon (umber tanah) | `#7C5A2B` | semantik cost/ton (gantikan ungu `#6C4FC4`) |

### Aturan bentuk & material
- Radius: kartu 10px, kontrol 8px, pill hanya untuk toggle segmented.
- Shadow: hairline 1px + shadow tipis statis; dilarang hover `translateY` + shadow-grow.
- Header halaman = **masthead datar**: paper, hairline bawah, judul display besar, meta (periode/divisi/scope) sebagai teks berseparator hairline. Dilarang gradient hero, motif daun/lingkaran, glass pill.
- KPI = **ledger cell**: flat, hairline, label small-caps tenang, angka Roboto Mono tabular, delta teks `▲ 3,2%` (bukan pill), sparkline tipis.
- Chart: `chartPalette` dari palet estate; grid hairline; tooltip flat 1px.
- Ikon: lucide-react; emoji dilarang pada halaman dalam scope.
- Motion: transisi ≤150–220ms, transform/opacity saja; hormati `prefers-reduced-motion`.
- Tipografi: Sora display / Inter body / Roboto Mono numerik (tetap, tidak ganti font).
- Tanpa em-dash (`—`) di string UI baru; pemisah memakai koma, titik, atau hairline.

## Perubahan fungsional (Executive)
1. `scope` ('panen'|'all') diteruskan ke SEMUA chart gang; backend 3 endpoint menerima `scope` opsional (default = perilaku lama).
2. Setiap chart gang diberi label cakupan eksplisit ("Semua Gang" / "Gang Panen (suffix H)").
3. Dropdown gang & gang-type mati dihapus dari header; filter tersisa: periode, divisi (drill penuh), scope.
4. InsightStrip: klik spike gang membuka `GangDetailModal(gangCode)`.
5. Fetch disatukan ke `utils/dashboardApi.js` (`dashFetch`): kandidat base `${VITE_API_BASE_URL}/payroll/dashboard` → `/payroll/dashboard` → `/backend/upah/payroll/dashboard`, respons ok pertama dipakai.
6. `utils/gangTypes.js`: `getGangType`, `isIJLGang`, `isPanenGang`, `GANG_ALL` sebagai SSOT heuristik gang.

## Perubahan fungsional (Dashboard)
- KPI band 6 ledger cell dari `executive-summary` (Total Upah Kotor, Cost/Ton, Tonase, Headcount, Premi Share, HK Utilization) + delta + sparkline + ScopeToggle (default `panen`, konsisten dengan Executive).
- Insight strip anomali, chart tren upah 12 bulan, breakdown biaya per divisi.
- Filter periode/divisi/gang dipertahankan; launcher tile & panel link dipertahankan dengan gaya flat satu aksen.

## Yang TIDAK berubah
- Route/slug, label navigasi, nama field form (IA & analytics preserved).
- 20+ halaman report lain tidak disunting; mereka mewarisi token baru via `tokens.css`/`reportTheme.jsx` (diverifikasi build + spot-check `/summary`, `/tonase-analysis`).
- Tanpa dependency baru; tanpa git commit.

## Verifikasi
- `cd backend && bun test` hijau (termasuk test scope baru).
- `cd frontend && npm run build` hijau; `npx vitest run src/utils/gangTypes.test.js` hijau.
- Screenshot `/` dan `/executive`: tanpa gradient hero, satu aksen, kontras AA, tanpa emoji.
- Sweep: tidak ada `—`, `LeafMotif`, `linear-gradient(115deg`, ungu `#6C4FC4` pada file scope.
